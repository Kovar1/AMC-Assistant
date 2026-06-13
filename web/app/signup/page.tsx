"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signup } from "@/lib/auth-actions";
import styles from "@/app/forms.module.css";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, null);
  return (
    <main className={styles.auth}>
      <h1>Create account</h1>
      <form action={action} className={styles.form}>
        <input className={styles.field} name="email" type="email" placeholder="Email" required autoComplete="email" />
        <input className={styles.field} name="password" type="password" placeholder="Password (8+ characters)" required minLength={8} autoComplete="new-password" />
        <button className={styles.button} disabled={pending}>{pending ? "Creating…" : "Sign up"}</button>
        {state?.error && <p className={styles.error}>{state.error}</p>}
        {state?.message && <p className={styles.message}>{state.message}</p>}
      </form>
      <p className={styles.muted}>
        Already have an account? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
