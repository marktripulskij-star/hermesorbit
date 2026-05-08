import React, { useRef, useState } from 'react'
import { authedFetch } from '../lib/supabase.js'
import './DocumentPanel.css'

export default function DocumentPanel({ sessionId, documents, onChange }) {
  const inputRef = useRef()
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  const uploadFiles = async (files) => {
    if (!files.length) return
    setUploading(true)
    setUploadError(null)
    const form = new FormData()
    for (const f of files) form.append('files', f)
    if (sessionId) form.append('sessionId', sessionId)
    try {
      const res = await authedFetch('/api/documents', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      onChange(data.documents, data.sessionId)
    } catch (e) {
      setUploadError(e.message)
    } finally {
      setUploading(false)
    }
  }

  const handleFiles = (e) => uploadFiles([...e.target.files])

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    uploadFiles([...e.dataTransfer.files])
  }

  const removeDoc = async (name) => {
    await authedFetch(`/api/documents/${sessionId}/${encodeURIComponent(name)}`, { method: 'DELETE' })
    onChange(documents.filter(d => d !== name), null)
  }

  return (
    <div className="doc-panel">
      <div className="doc-panel-header">
        <span className="doc-panel-title">Documents</span>
        <span className="doc-count">{documents.length}</span>
      </div>

      <div
        className={`drop-zone ${dragOver ? 'drag-over' : ''}`}
        onClick={() => inputRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md"
          onChange={handleFiles}
          style={{ display: 'none' }}
        />
        {uploading ? (
          <><span className="spinner" />Uploading…</>
        ) : (
          <>
            <span className="drop-icon">📄</span>
            <span>Drop PDFs or text files</span>
            <span className="drop-sub">or click to browse</span>
          </>
        )}
      </div>

      <ul className="doc-list">
        {documents.map(name => (
          <li key={name} className="doc-item">
            <span className="doc-icon">📄</span>
            <span className="doc-name" title={name}>{name}</span>
            <button className="doc-remove" onClick={() => removeDoc(name)} title="Remove">✕</button>
          </li>
        ))}
      </ul>

      {uploadError && (
        <div className="upload-error">⚠ {uploadError}</div>
      )}

      {documents.length === 0 && !uploadError && (
        <p className="doc-hint">Upload avatar profiles, brand voice docs, competitor analyses, or any reference material.</p>
      )}
    </div>
  )
}
