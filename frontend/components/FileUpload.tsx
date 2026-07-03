"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";
import { authHeaders } from "@/lib/auth";

interface FileUploadProps {
  /** FastAPI endpoint path, e.g. "/api/nomina" */
  endpoint: string;
  /** Allow selecting multiple files */
  multiple?: boolean;
  /** Form field name expected by FastAPI (default "files") */
  fieldName?: string;
  /** Called with parsed JSON response on success */
  onResult: (data: Record<string, unknown>) => void;
  /** Accepted file types, e.g. ".xlsx,.xls" */
  accept?: string;
  /** Label shown inside the drop zone */
  label?: string;
  /** Extra form fields appended to FormData before upload */
  extraFields?: Record<string, string>;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function FileUpload({
  endpoint,
  multiple = false,
  fieldName = "files",
  onResult,
  accept = ".xlsx,.xls",
  label,
  extraFields,
}: FileUploadProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setError(null);
    setLoading(true);
    setFileNames(Array.from(files).map((f) => f.name));

    const form = new FormData();
    if (extraFields) Object.entries(extraFields).forEach(([k, v]) => form.append(k, v));
    Array.from(files).forEach((file) => form.append(fieldName, file));

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(detail?.detail ?? `Error ${res.status}`);
      }
      const data = await res.json();
      onResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) upload(e.target.files);
  }

  const dropLabel =
    label ??
    (multiple
      ? "Arrastrá los archivos Excel aquí o hacé clic para seleccionar"
      : "Arrastrá el archivo Excel aquí o hacé clic para seleccionar");

  return (
    <div className="w-full">
      {/* Drop zone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={[
          "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors select-none",
          dragging
            ? "border-[#4f8ef7] bg-[#4f8ef7]/8"
            : "border-white/[0.08] bg-[#1a1f2e] hover:border-[#4f8ef7]/50 hover:bg-[#1a2240]",
        ].join(" ")}
      >
        {/* Upload icon */}
        <svg
          className={`w-10 h-10 ${dragging ? "text-[#4f8ef7]" : "text-slate-400"}`}
          fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 16.5V9.75m0 0-3 3m3-3 3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.338-2.032A4.5 4.5 0 0 1 17.25 19.5H6.75Z"
          />
        </svg>

        <p className="text-sm text-slate-300 text-center">{dropLabel}</p>
        <p className="text-xs text-slate-500">Formatos: {accept.replaceAll(",", " ")}</p>

        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          className="hidden"
          onChange={handleChange}
        />
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="mt-4 flex items-center gap-3 text-sm text-slate-300">
          <svg className="animate-spin w-5 h-5 text-[#4f8ef7]" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span>Procesando{fileNames.length ? `: ${fileNames.join(", ")}` : "…"}</span>
        </div>
      )}

      {/* File names (after selection, before loading finishes) */}
      {!loading && fileNames.length > 0 && !error && (
        <p className="mt-3 text-xs text-slate-400 truncate">
          {fileNames.join(" · ")}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-300">
          <svg className="mt-0.5 w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
