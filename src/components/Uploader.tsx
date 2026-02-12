import { memo, useCallback, useRef } from "react"

interface UploaderProps {
  disabled?: boolean
  onUpload: (file: File) => void | Promise<void>
  label?: string
}

const Uploader = memo(function Uploader({
  disabled = false,
  onUpload,
  label = "Upload PDF",
}: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    // Reset input value to allow re-uploading the same file
    if (inputRef.current) inputRef.current.value = ""
  }, [onUpload])

  const buttonStyle = disabled ? { opacity: 0.6 } : undefined

  return (
    <label className=" block">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        disabled={disabled}
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <span
        className={`btn ${disabled ? "btn-disabled" : ""}`}
        style={buttonStyle}
      >
        {label}
      </span>
    </label>
  )
})

export default Uploader
