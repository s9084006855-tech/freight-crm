import { useRef, useState } from "react";

interface Props {
  onFiles: (files: File[]) => void;
  accept?: string;
  label?: string;
}

export function DropZone({ onFiles, accept = ".csv,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp", label }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.name.match(/\.(csv|xlsx|xls|pdf|png|jpg|jpeg|webp|txt)$/i)
    );
    if (files.length) onFiles(files);
  };

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-10 cursor-pointer transition-colors ${
        dragging
          ? "border-zinc-400 bg-zinc-800/50"
          : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900"
      }`}
    >
      <span className="text-2xl text-zinc-600">↑</span>
      <p className="text-sm text-zinc-400">
        {label ?? "Drop files here or click to browse"}
      </p>
      <p className="text-xs text-zinc-600">CSV, XLSX, PDF, images</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
        className="hidden"
      />
    </div>
  );
}
