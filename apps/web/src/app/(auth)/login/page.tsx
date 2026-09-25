"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import Link from "next/link";
import { loginSchema } from "@/lib/account-validation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    setError(null);

    try {
      const result = await signIn("credentials", {
        email: values.email,
        password: values.password,
        redirect: false,
      });

      if (result?.error) {
        setError("Unable to sign in. Check your email and password, verify your email, or wait 15 minutes if you have tried repeatedly.");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Unable to sign in right now. Please try again.");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md space-y-8 rounded-xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white">NexRole</h1>
          <p className="mt-2 text-zinc-400">Sign in to your B2B dashboard</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-zinc-300">Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="admin@sensei.com"
                      {...field}
                      className="bg-zinc-800 border-zinc-700 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-zinc-300">Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      {...field}
                      className="bg-zinc-800 border-zinc-700 text-white"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {error && (
              <p className="text-sm font-medium text-red-500">{error}</p>
            )}

            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {form.formState.isSubmitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </Form>
        <nav className="flex flex-wrap gap-4 text-sm text-blue-400">
          <Link href="/register">Create a workspace</Link>
          <Link href="/forgot-password">Forgot password</Link>
          <Link href="/verify-email">Resend verification</Link>
        </nav>
      </div>
    </div>
  );
}
