"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset } from "@/lib/auth-actions";
import styles from "@/app/forms.module.css";

export default function ResetPage() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);
  return (
    <main className={styles.auth}>
      <h1>Reset password</h1>
      <form action={action} className={styles.form}>
        <input className={styles.field} name="email" type="email" placeholder="Email" required autoComplete="email" />
        <button className={styles.button} disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
        {state?.error && <p className={styles.error}>{state.error}</p>}
        {state?.message && <p className={styles.message}>{state.message}</p>}
      </form>
      <p className={styles.muted}>
        <Link href="/login">Back to log in</Link>
      </p>
    </main>
  );
}
