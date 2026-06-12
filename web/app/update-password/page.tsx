"use client";

import { useActionState } from "react";
import { updatePassword } from "@/lib/auth-actions";
import styles from "@/app/forms.module.css";

export default function UpdatePasswordPage() {
  const [state, action, pending] = useActionState(updatePassword, null);
  return (
    <main className={styles.auth}>
      <h1>Set a new password</h1>
      <form action={action} className={styles.form}>
        <input className={styles.field} name="password" type="password" placeholder="New password (8+ characters)" required minLength={8} autoComplete="new-password" />
        <button className={styles.button} disabled={pending}>{pending ? "Saving…" : "Save password"}</button>
        {state?.error && <p className={styles.error}>{state.error}</p>}
      </form>
    </main>
  );
}
