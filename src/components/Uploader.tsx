export default function Uploader({
    disabled,
    onUpload,
    label = "Upload PDF",
  }: {
    disabled?: boolean;
    onUpload: (file: File) => void | Promise<void>;
    label?: string;
  }) {
    return (
      <label className="mt-10 block">
        <input
          type="file"
          accept="application/pdf"
          disabled={disabled}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.currentTarget.value = "";
          }}
        />
        <span className={`btn ${disabled ? "btn-disabled" : ""}`} style={disabled ? { opacity: 0.6 } : undefined}>{label}</span>
      </label>
    );
  }
  