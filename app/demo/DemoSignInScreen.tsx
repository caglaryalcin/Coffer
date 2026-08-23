"use client";

import { useId, useState, type FormEvent } from "react";

type DemoSignInScreenProps = {
  onSignIn: () => void;
};

const DEMO_USERNAME = "demo";
const DEMO_PASSWORD = "demo";

function validDemoCredentials(username: string, password: string) {
  return username.trim() === DEMO_USERNAME && password === DEMO_PASSWORD;
}

export default function DemoSignInScreen({ onSignIn }: DemoSignInScreenProps) {
  const id = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const usernameId = `${id}-username`;
  const passwordId = `${id}-password`;
  const errorId = `${id}-error`;
  const titleId = `${id}-title`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Enter the demo username and password.");
      return;
    }
    if (!validDemoCredentials(username, password)) {
      setError("The demo username or password is incorrect.");
      return;
    }

    setError(null);
    setPassword("");
    onSignIn();
  };

  return (
    <main className="transfer-center auth-screen demo-sign-in-screen theme-dark" aria-labelledby={titleId}>
      <header className="transfer-heading auth-intro">
        <div className="auth-intro-copy">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span>Coffer</span>
          </div>
          <p className="auth-tagline">Your codes. Yours alone.</p>
        </div>
      </header>

      <section
        className="transfer-panel auth-access-panel demo-login-panel"
        aria-labelledby={titleId}
      >
        <div className="review-head auth-form-heading">
          <div>
            <span className="demo-login-badge">Public demo</span>
            <h2 id={titleId}>Sign in to the demo</h2>
            <p>Explore Coffer with temporary sample authenticator accounts.</p>
          </div>
        </div>

        {error && (
          <div className="transfer-error" id={errorId} role="alert">
            <span aria-hidden="true">!</span>
            {error}
          </div>
        )}

        <form className="transfer-form" onSubmit={submit} autoComplete="off" noValidate>
          <label htmlFor={usernameId}>
            <span>Username</span>
            <input
              id={usernameId}
              name="username"
              type="text"
              value={username}
              placeholder="demo"
              maxLength={64}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setUsername(event.target.value);
                setError(null);
              }}
            />
          </label>

          <label htmlFor={passwordId}>
            <span>Password</span>
            <input
              id={passwordId}
              name="password"
              type="password"
              value={password}
              placeholder="demo"
              maxLength={64}
              autoComplete="off"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
            />
          </label>

          <div className="transfer-footer auth-submit-footer">
            <aside className="local-only-note" role="note" aria-label="Temporary demo session">
              <span className="local-note-icon" aria-hidden="true" />
              Temporary demo session<br />
              <small>All changes reset after one hour</small>
            </aside>
            <button className="transfer-primary" type="submit">
              Sign in <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
