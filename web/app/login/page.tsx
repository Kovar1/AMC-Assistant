"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login } from "@/lib/auth-actions";
import styles from "@/app/forms.module.css";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <main className={styles.auth}>
      <h1>Log in</h1>
      <form action={action} className={styles.form}>
        <input className={styles.field} name="email" type="email" placeholder="Email" required autoComplete="email" />
        <input className={styles.field} name="password" type="password" placeholder="Password" required autoComplete="current-password" />
        <button className={styles.button} disabled={pending}>{pending ? "Logging in…" : "Log in"}</button>
        {state?.error && <p className={styles.error}>{state.error}</p>}
      </form>
      <p className={styles.muted}>
        <Link href="/reset">Forgot password?</Link> · <Link href="/signup">Create account</Link>
      </p>
    </main>
  );
}
