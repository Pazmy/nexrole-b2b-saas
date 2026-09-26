const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute real TS services/actions. Replace only framework transport and configured external boundaries.
module.exports = function harness(database, mail) {
  let session = null, authConfig;
  const originalLoad = Module._load;
  require.extensions['.ts'] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
    });
    module._compile(outputText, filename);
  };
  Module._load = function(request, parent, isMain) {
    if (request === 'server-only') return {};
    if (request === '@nexrole/database') return { prisma: database };
    if (request === 'next/headers') return { headers: async () => new Headers() };
    if (request === 'next/cache') return { revalidatePath() {} };
    if (request === 'next-auth') return (options) => { authConfig = options; return { auth: async () => session }; };
    if (request === 'next-auth/providers/credentials') return (options) => options;
    if (request === '@/lib/audit') return { writeAuditLog: async () => {} };
    if (mail && (request === './email' || request === '@/lib/email')) return { sendAccountEmail: mail };
    if (request.startsWith('@/')) request = path.resolve(__dirname, '../apps/web/src', request.slice(2));
    return originalLoad.call(this, request, parent, isMain);
  };
  return { setSession(value) { session = value; }, get config() { return authConfig; }, restore() { Module._load = originalLoad; } };
};
