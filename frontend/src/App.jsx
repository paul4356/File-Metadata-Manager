import { useCallback, useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "";

async function api(path, options = {}, token) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function App() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [files, setFiles] = useState([]);
  const [filename, setFilename] = useState("");
  const [sizeBytes, setSizeBytes] = useState("");
  const [contentType, setContentType] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFiles = useCallback(async (authToken) => {
    const result = await api("/api/files", {}, authToken);
    setFiles(result.files);
  }, []);

  useEffect(() => {
    if (!token) return;
    loadFiles(token).catch((err) => setError(err.message));
  }, [token, loadFiles]);

  async function submitAuth(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const normalizedPhone = phone.trim();
    try {
      if (!codeSent) {
        if (!/^\+91[6-9]\d{9}$/.test(normalizedPhone)) {
          throw new Error("Enter an Indian mobile number in international format, for example +919876543210.");
        }
        await api("/api/auth/otp", {
          method: "POST",
          body: JSON.stringify({ phone: normalizedPhone })
        });
        setCodeSent(true);
        setMessage("Code requested. Check WhatsApp first, then SMS.");
      } else {
        if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit code from WhatsApp or SMS.");
        const result = await api("/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({ phone: normalizedPhone, code })
        });
        setToken(result.token);
        setUser(result.user.phone);
        setCode("");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addFile(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/api/files", {
        method: "POST",
        body: JSON.stringify({ filename, sizeBytes: Number(sizeBytes), contentType })
      }, token);
      setFilename("");
      setSizeBytes("");
      setContentType("");
      await loadFiles(token);
      setMessage("Metadata added.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeFile(id) {
    setError("");
    setMessage("");
    try {
      await api(`/api/files/${id}`, { method: "DELETE" }, token);
      setFiles((current) => current.filter((file) => file.id !== id));
    } catch (err) {
      setError(err.message);
    }
  }

  function signOut() {
    setToken("");
    setUser(null);
    setFiles([]);
    setPhone("");
    setCode("");
    setCodeSent(false);
    setMessage("");
    setError("");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="File Metadata Manager home">
          <span className="brand-mark">FM</span>
          <span>file<span className="brand-light">notes</span></span>
        </a>
        <span className="topbar-note">A tidy home for file details</span>
      </header>

      <section className="intro">
        <p className="eyebrow">KEEP THE DETAILS</p>
        <h1>Your files,<br /><em>properly catalogued.</em></h1>
        <p className="lede">Save the useful bits about your files. No uploads, just the metadata you need.</p>
      </section>

      <section className="panel">
        {!user ? (
          <div className="auth-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">{codeSent ? "CHECK YOUR PHONE" : "WHATSAPP + SMS OTP"}</p>
                <h2>{codeSent ? "Enter your code" : "Sign in or create an account"}</h2>
              </div>
              <span className="step">{codeSent ? "02 / 02" : "01 / 02"}</span>
            </div>
            <form onSubmit={submitAuth}>
              <label>
                Phone number
                <input
                  type="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+919876543210"
                  disabled={codeSent}
                  required
                />
                <span className="field-hint">Indian mobile number, including +91.</span>
              </label>
              {codeSent && (
                <label>
                  Six-digit code
                  <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} pattern="\d{6}" required />
                </label>
              )}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? "Please wait…" : codeSent ? "Verify & continue" : "Send me a code"}
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            </form>
            {codeSent && <button className="text-button" onClick={() => { setCodeSent(false); setCode(""); setError(""); }}>Use a different number</button>}
          </div>
        ) : (
          <div className="workspace">
            <div className="card-heading">
              <div>
                <p className="eyebrow">YOUR COLLECTION</p>
                <h2>Hello, {user}</h2>
              </div>
              <button className="text-button sign-out" onClick={signOut}>Sign out ↗</button>
            </div>
            <form className="metadata-form" onSubmit={addFile}>
              <label>
                File name
                <input value={filename} onChange={(event) => setFilename(event.target.value)} maxLength={255} placeholder="annual-report.pdf" required />
              </label>
              <div className="form-row">
                <label>
                  Size (bytes)
                  <input type="number" min="0" step="1" value={sizeBytes} onChange={(event) => setSizeBytes(event.target.value)} placeholder="204800" required />
                </label>
                <label>
                  Content type
                  <input value={contentType} onChange={(event) => setContentType(event.target.value)} maxLength={120} placeholder="application/pdf" required />
                </label>
              </div>
              <button className="primary-button" type="submit" disabled={busy}>Add metadata <span aria-hidden="true">＋</span></button>
            </form>
            <div className="list-heading"><h3>Saved files</h3><span>{files.length.toString().padStart(2, "0")}</span></div>
            {files.length ? (
              <ul className="file-list">
                {files.map((file) => (
                  <li className="file-item" key={file.id}>
                    <span className="file-icon" aria-hidden="true">↳</span>
                    <div className="file-info">
                      <strong>{file.filename}</strong>
                      <span>{file.contentType} · {formatSize(file.sizeBytes)}</span>
                    </div>
                    <button className="delete-button" onClick={() => removeFile(file.id)} aria-label={`Delete ${file.filename}`}>×</button>
                  </li>
                ))}
              </ul>
            ) : <p className="empty-state">Nothing here yet. Add your first file above.</p>}
          </div>
        )}
        {(error || message) && <p className={`notice ${error ? "notice-error" : "notice-success"}`} role={error ? "alert" : "status"}>{error || message}</p>}
      </section>
      <footer><span>FILE METADATA MANAGER</span><span>Small details. Sorted.</span></footer>
    </main>
  );
}
