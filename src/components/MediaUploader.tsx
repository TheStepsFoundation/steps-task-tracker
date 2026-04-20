"use client"

import { useRef, useState } from "react"
import { supabase } from "@/lib/supabase"

/**
 * Upload widget used by the FormBuilder "Image or PDF" field type. Accepts
 * JPG/PNG/WebP/GIF up to 10 MB or application/pdf up to 10 MB. Uploads to the
 * existing `event-banners` bucket under a `form-media/` prefix so RLS /
 * public-read rules are inherited.
 */

type Props = {
  url: string
  mediaType: "image" | "pdf"
  onChange: (url: string, mediaType: "image" | "pdf") => void
}

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const PDF_MIME = "application/pdf"
const MAX_BYTES = 10 * 1024 * 1024

export default function MediaUploader({ url, mediaType, onChange }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const handleUpload = async (file: File) => {
    setError(null)

    const isImage = IMAGE_MIMES.includes(file.type)
    const isPdf = file.type === PDF_MIME
    if (!isImage && !isPdf) {
      setError("Use JPG, PNG, WebP, GIF or PDF.")
      return
    }
    if (file.size > MAX_BYTES) {
      setError("Max file size is 10 MB.")
      return
    }

    setUploading(true)
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || (isPdf ? "pdf" : "jpg")
      const rand = Math.random().toString(36).slice(2, 8)
      const objectKey = `form-media/${Date.now()}-${rand}.${ext}`
      const { error: upErr } = await supabase.storage
        .from("event-banners")
        .upload(objectKey, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type,
        })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from("event-banners").getPublicUrl(objectKey)
      if (!pub?.publicUrl) throw new Error("Could not resolve public URL")
      onChange(pub.publicUrl, isPdf ? "pdf" : "image")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed"
      console.error("MediaUploader upload failed", err)
      setError(msg)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) void handleUpload(file)
  }

  const clear = () => {
    onChange("", mediaType)
  }

  return (
    <div className="space-y-2">
      {url ? (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 bg-white dark:bg-gray-900">
          {mediaType === "pdf" ? (
            <div className="h-40 rounded overflow-hidden border border-gray-200 dark:border-gray-700">
              <iframe src={url} className="w-full h-full" title="PDF preview" />
            </div>
          ) : (
            <div className="h-40 rounded overflow-hidden flex items-center justify-center bg-gray-50 dark:bg-gray-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Uploaded media preview" className="max-h-full max-w-full object-contain" />
            </div>
          )}
          <div className="flex items-center justify-between mt-1">
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="text-[10px] text-steps-blue-600 hover:underline truncate max-w-[60%]">
              {url.split("/").pop()}
            </a>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="text-[10px] text-gray-500 hover:text-gray-700 hover:underline">Replace</button>
              <button type="button" onClick={clear}
                className="text-[10px] text-red-500 hover:text-red-700 hover:underline">Remove</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg py-6 text-center text-xs text-gray-500 hover:border-steps-blue-500 hover:text-steps-blue-600 transition"
        >
          {uploading ? "Uploading…" : "📷 Click to upload image or PDF (max 10 MB)"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        onChange={onFileInputChange}
        className="hidden"
      />
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  )
}
