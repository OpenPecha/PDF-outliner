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

  return (
    <label className="block cursor-pointer w-full">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        disabled={disabled}
        className="hidden"
        onChange={handleChange}
        aria-label={label}
      />
      <span
        className="inline-block w-full text-center px-4 py-2 bg-white text-gray-700 text-sm font-semibold rounded-lg border border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-all duration-200 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:shadow-sm"
      >
        {label}
      </span>
    </label>
  )
})

export default Uploader
