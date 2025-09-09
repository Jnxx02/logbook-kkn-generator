import React, { useState, useEffect } from 'react';
import './App.css';
import { idbSaveImage, idbGetImage, idbDeleteImage } from './lib/idb';

function App() {
  const [entries, setEntries] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [activeTab, setActiveTab] = useState('form'); // 'form' | 'preview'
  const [pageSize, setPageSize] = useState(10);
  const [formData, setFormData] = useState({
    tanggal: '',
    jam_mulai: '',
    jam_selesai: '',
    judul_kegiatan: '',
    rincian_kegiatan: '',
    dokumen_pendukung: null,
    dokumen_pendukung_key: null
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [page, setPage] = useState(1);

  // Compress image using canvas (max width/height and JPEG quality)
  const compressImage = async (dataUrl, options = { maxWidth: 1280, maxHeight: 1280, quality: 0.7 }) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const { maxWidth, maxHeight, quality } = options;

        const ratio = Math.min(1, maxWidth / width, maxHeight / height);
        const targetWidth = Math.round(width * ratio);
        const targetHeight = Math.round(height * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

        try {
          const out = canvas.toDataURL('image/jpeg', quality);
          resolve(out);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Gagal memuat gambar untuk kompresi'));
      img.src = dataUrl;
    });
  };

  const dataUrlSizeBytes = (dataUrl) => {
    if (!dataUrl) return 0;
    // Rough estimate: base64 size = (length - header) * 0.75
    const idx = dataUrl.indexOf(',');
    const base64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
    return Math.floor(base64.length * 0.75);
  };

  const compressToMaxBytes = async (dataUrl, maxBytes) => {
    // Try progressively lower quality and smaller dimensions until under maxBytes
    let quality = 0.7;
    let maxW = 1280;
    let maxH = 1280;
    for (let i = 0; i < 8; i++) {
      const out = await compressImage(dataUrl, { maxWidth: maxW, maxHeight: maxH, quality });
      if (dataUrlSizeBytes(out) <= maxBytes) return out;
      // reduce quality then dimensions
      if (quality > 0.5) {
        quality -= 0.1;
      } else {
        maxW = Math.max(480, Math.floor(maxW * 0.8));
        maxH = Math.max(480, Math.floor(maxH * 0.8));
        if (maxW === 480 && maxH === 480 && quality <= 0.5) {
          // final try lower quality
          quality = Math.max(0.35, quality - 0.1);
        }
      }
    }
    return await compressImage(dataUrl, { maxWidth: maxW, maxHeight: maxH, quality: Math.max(0.35, quality) });
  };

  // Helper: safely save entries to localStorage without exceeding quota
  const safeSaveEntries = (allEntries) => {
    const entriesWithoutImages = allEntries.map((e) => ({
      id: e.id,
      tanggal: e.tanggal,
      jam: e.jam,
            judul_kegiatan: e.judul_kegiatan,
            rincian_kegiatan: e.rincian_kegiatan,
      dokumen_pendukung: e.dokumen_pendukung_key || null,
    }));
    try {
      localStorage.setItem('logbook_entries', JSON.stringify(entriesWithoutImages));
    } catch (err) {
      let sliceSize = Math.max(0, Math.floor(entriesWithoutImages.length * 0.8));
      while (sliceSize > 0) {
        try {
          localStorage.setItem('logbook_entries', JSON.stringify(entriesWithoutImages.slice(-sliceSize)));
          alert('Penyimpanan hampir penuh. Sebagian entri lama tidak disimpan ke localStorage.');
          return;
        } catch (_) {
          sliceSize = Math.floor(sliceSize * 0.8);
        }
      }
      console.error('Gagal menyimpan ke localStorage:', err);
    }
  };

  // Load data on component mount
  useEffect(() => {
    const saved = localStorage.getItem('logbook_entries');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        Promise.all(
          (parsed || []).map(async (e) => {
            const key = e.dokumen_pendukung;
            if (key) {
              const dataUrl = await idbGetImage(key);
              return { ...e, dokumen_pendukung_key: key, dokumen_pendukung: dataUrl };
            }
            return { ...e, dokumen_pendukung_key: null, dokumen_pendukung: null };
          })
        ).then(setEntries).catch(() => setEntries(parsed));
      } catch (error) {
        console.error('Error parsing localStorage data:', error);
      }
    }
    setIsInitialized(true);
  }, []);

  // Save to localStorage whenever entries change (but not on initial load)
  useEffect(() => {
    if (isInitialized) {
      safeSaveEntries(entries);
    }
  }, [entries, isInitialized]);
  
  // Auth removed: app works entirely offline using localStorage

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Check file size (10MB limit)
      if (file.size > 10 * 1024 * 1024) {
        alert('Ukuran file terlalu besar. Maksimal 10MB.');
        return;
      }

      // Check file type
      if (!file.type.startsWith('image/')) {
        alert('Hanya file gambar yang diperbolehkan.');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (e) => {
        let dataUrl = e.target.result;
        try {
          // target ~400KB per gambar untuk menjaga payload tetap kecil
          dataUrl = await compressToMaxBytes(dataUrl, 400 * 1024);
        } catch (err) {
          console.warn('Kompresi gambar gagal, menggunakan gambar asli.');
        }
        const key = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
          await idbSaveImage(key, dataUrl);
        setFormData(prev => ({
          ...prev,
            dokumen_pendukung: dataUrl,
            dokumen_pendukung_key: key,
        }));
        } catch (err) {
          alert('Gagal menyimpan gambar ke IndexedDB');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.tanggal || !formData.jam_mulai || !formData.jam_selesai || !formData.judul_kegiatan || !formData.rincian_kegiatan) {
      alert('Mohon lengkapi semua field yang wajib diisi.');
      return;
    }

    // Combine jam_mulai and jam_selesai into jam format
    const jamCombined = `${formData.jam_mulai} - ${formData.jam_selesai}`;

    const saveLocal = () => {
      if (isEditing) {
        setEntries(prev => prev.map(entry => 
          entry.id === editingId 
            ? { ...formData, jam: jamCombined, id: editingId }
            : entry
        ));
        setIsEditing(false);
        setEditingId(null);
      } else {
        const newEntry = {
          ...formData,
          jam: jamCombined,
          id: Date.now().toString()
        };
        setEntries(prev => [...prev, newEntry]);
      }
    };

    // Always local-only now
      saveLocal();

    // Reset form
    setFormData({
      tanggal: '',
      jam_mulai: '',
      jam_selesai: '',
      judul_kegiatan: '',
      rincian_kegiatan: '',
      dokumen_pendukung: null,
      dokumen_pendukung_key: null
    });
    
    // Reset file input
    const fileInput = document.getElementById('dokumen_pendukung');
    if (fileInput) fileInput.value = '';
  };

  const handleEdit = (entry) => {
    // Split jam back to jam_mulai and jam_selesai
    const jamParts = entry.jam.split(' - ');
    setFormData({
      tanggal: entry.tanggal,
      jam_mulai: jamParts[0] || '',
      jam_selesai: jamParts[1] || '',
      judul_kegiatan: entry.judul_kegiatan,
      rincian_kegiatan: entry.rincian_kegiatan,
      dokumen_pendukung: entry.dokumen_pendukung,
      dokumen_pendukung_key: entry.dokumen_pendukung_key || null
    });
    setIsEditing(true);
    setEditingId(entry.id);
    setActiveTab('form');
  };

  const handleDelete = (id) => {
    if (window.confirm('Yakin ingin menghapus kegiatan ini?')) {
        setEntries(prev => {
          const target = prev.find((e) => e.id === id);
          if (target && target.dokumen_pendukung_key) {
            idbDeleteImage(target.dokumen_pendukung_key).catch(() => {});
          }
          return prev.filter(entry => entry.id !== id);
        });
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingId(null);
    setFormData({
      tanggal: '',
      jam_mulai: '',
      jam_selesai: '',
      judul_kegiatan: '',
      rincian_kegiatan: '',
      dokumen_pendukung: null,
      dokumen_pendukung_key: null
    });
    const fileInput = document.getElementById('dokumen_pendukung');
    if (fileInput) fileInput.value = '';
  };

  const handleGenerateWord = async () => {
    if (filteredEntries.length === 0) {
      alert('Tidak ada kegiatan untuk di-generate. Tambahkan kegiatan terlebih dahulu.');
      return;
    }

    setIsGenerating(true);
    try {
      const baseUrl = process.env.REACT_APP_BACKEND_URL || '';
      const payloadEntries = filteredEntries.map((e) => ({
        ...e,
        dokumen_pendukung: includeImages ? e.dokumen_pendukung : null,
      }));
      let headers = { 'Content-Type': 'application/json' };
      let body;
      try {
        const supportsCompressionStream = typeof CompressionStream !== 'undefined';
        if (supportsCompressionStream) {
          const cs = new CompressionStream('gzip');
          const blob = new Blob([JSON.stringify({ entries: payloadEntries })], { type: 'application/json' });
          const stream = blob.stream().pipeThrough(cs);
          const compressed = await new Response(stream).arrayBuffer();
          headers = { ...headers, 'Content-Encoding': 'gzip' };
          body = compressed;
        } else {
          body = JSON.stringify({ entries: payloadEntries });
        }
      } catch (_) {
        body = JSON.stringify({ entries: payloadEntries });
      }

      const response = await fetch(`${baseUrl}/api/generate-word`, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const raw = await response.text();
        let message = 'Gagal generate dokumen Word';
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            message = parsed?.detail || raw;
          } catch (_) {
            message = raw;
          }
        }
        throw new Error(message);
      }

      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `logbook_${new Date().toISOString().slice(0, 10)}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      alert('Dokumen Word berhasil di-generate dan didownload!');
    } catch (error) {
      console.error('Error generating Word document:', error);
      alert(`Terjadi kesalahan saat generate dokumen Word: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const formatTanggal = (isoDate) => {
    if (!isoDate) return '';
    try {
      const dt = new Date(isoDate);
      const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
      const dd = String(dt.getDate()).padStart(2, '0');
      const mmName = bulan[dt.getMonth()];
      const yyyy = dt.getFullYear();
      return `${dd} ${mmName} ${yyyy}`;
    } catch (e) {
      return isoDate;
    }
  };

  const parseMinutesFromJam = (jam) => {
    if (!jam || typeof jam !== 'string') return 0;
    const parts = jam.split(' - ');
    if (parts.length !== 2) return 0;
    const [start, end] = parts;
    const [sh, sm] = (start || '').split(':').map((v) => parseInt(v, 10));
    const [eh, em] = (end || '').split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(sh) || Number.isNaN(sm) || Number.isNaN(eh) || Number.isNaN(em)) return 0;
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    const diff = endMin - startMin;
    return diff > 0 ? diff : 0;
  };

  const getStartMinutes = (jam) => {
    if (!jam || typeof jam !== 'string') return 0;
    const start = jam.split(' - ')[0] || '';
    const [h, m] = start.split(':').map((v) => parseInt(v, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
  };

  const compareByDateTime = (a, b) => {
    // Earlier date first
    const ta = a.tanggal ? new Date(a.tanggal).getTime() : 0;
    const tb = b.tanggal ? new Date(b.tanggal).getTime() : 0;
    if (ta !== tb) return ta - tb;
    // Same date: earlier start time first
    return getStartMinutes(a.jam) - getStartMinutes(b.jam);
  };

  const sortedEntries = React.useMemo(() => {
    return [...entries].sort(compareByDateTime);
  }, [entries]);

  const filteredEntries = React.useMemo(() => {
    const start = filterStartDate ? new Date(filterStartDate) : null;
    const end = filterEndDate ? new Date(filterEndDate) : null;
    return sortedEntries.filter((e) => {
      if (!e.tanggal) return false;
      const d = new Date(e.tanggal);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [sortedEntries, filterStartDate, filterEndDate]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStartIndex = (currentPage - 1) * pageSize;
  const pageEndIndex = Math.min(pageStartIndex + pageSize, filteredEntries.length);
  const pageEntries = filteredEntries.slice(pageStartIndex, pageEndIndex);

  useEffect(() => {
    // Reset to page 1 when filters or pageSize change
    setPage(1);
  }, [filterStartDate, filterEndDate, pageSize]);

  const totalMinutesAll = filteredEntries.reduce((acc, e) => acc + parseMinutesFromJam(e.jam), 0);
  const totalHours = Math.floor(totalMinutesAll / 60);
  const totalRemainderMinutes = totalMinutesAll % 60;
  const uniqueDatesCount = (() => {
    const set = new Set((filteredEntries || []).map((e) => e.tanggal).filter(Boolean));
    return set.size;
  })();

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3">
            <div className="text-sm text-yellow-800 space-y-1">
              <p>
                Pemberitahuan: Data logbook disimpan lokal di browser ini. Teks disimpan di localStorage, sedangkan gambar disimpan di IndexedDB agar tidak melebihi kuota penyimpanan.
              </p>
              <p>
                Setelah halaman di-refresh, gambar akan otomatis dipulihkan dari IndexedDB. Jika mode privat/penyimpanan diblokir, gambar tidak bisa dipulihkan.
              </p>
              <p>
                Jika jumlah entri/gambar sangat banyak, gunakan filter tanggal (Dari/Sampai) di Preview untuk generate bertahap. Anda juga bisa menyalakan/mematikan opsi “Sertakan gambar saat generate”.
              </p>
            </div>
          </div>
          <div className="bg-blue-600 px-6 py-4">
            <h1 className="text-2xl font-bold text-white">Generator Logbook Otomatis</h1>
            <p className="text-blue-100 mt-1">Buat dokumen logbook dalam format Word secara otomatis</p>
          </div>

          <div className="p-6">
                {/* Tabs */}
                <div className="mb-6">
                  <div className="inline-flex rounded-md shadow-sm" role="group">
                    <button
                      type="button"
                      onClick={() => setActiveTab('form')}
                      className={`px-4 py-2 text-sm font-medium border ${activeTab === 'form' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    >
                      Tambah Kegiatan
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('preview')}
                      className={`px-4 py-2 text-sm font-medium border-t border-b border-r ${activeTab === 'preview' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}
                    >
                      Preview Logbook
                    </button>
                  </div>
                </div>

            {/* Form Input */}
            {activeTab === 'form' && (
            <div className="bg-gray-50 rounded-lg p-6 mb-8">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                {isEditing ? 'Edit Kegiatan' : 'Tambah Kegiatan Baru'}
              </h2>
              
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tanggal <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      name="tanggal"
                      value={formData.tanggal}
                      onChange={handleInputChange}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Jam Mulai <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      name="jam_mulai"
                      value={formData.jam_mulai}
                      onChange={handleInputChange}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Jam Selesai <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="time"
                      name="jam_selesai"
                      value={formData.jam_selesai}
                      onChange={handleInputChange}
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Judul Kegiatan <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="judul_kegiatan"
                    value={formData.judul_kegiatan}
                    onChange={handleInputChange}
                    placeholder="Masukkan judul kegiatan..."
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rincian Kegiatan <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    name="rincian_kegiatan"
                    value={formData.rincian_kegiatan}
                    onChange={handleInputChange}
                    placeholder="Masukkan rincian kegiatan..."
                    rows="4"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Dokumen Pendukung (Gambar)
                  </label>
                  <input
                    type="file"
                    id="dokumen_pendukung"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  />
                  <p className="text-sm text-gray-500 mt-1">Maksimal 10MB. Format: JPG, PNG, GIF</p>
                  
                  {formData.dokumen_pendukung && (
                    <div className="mt-3">
                      <img 
                        src={formData.dokumen_pendukung} 
                        alt="Preview" 
                        className="max-w-xs h-32 object-cover rounded-md border"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-4">
                  <button
                    type="submit"
                    className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
                  >
                    {isEditing ? 'Update Kegiatan' : 'Tambah Kegiatan'}
                  </button>
                  
                  {isEditing && (
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="bg-gray-500 text-white px-6 py-2 rounded-md hover:bg-gray-600 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors"
                    >
                      Batal
                    </button>
                  )}
                </div>
              </form>
            </div>
            )}

            {/* Preview Logbook */}
            {activeTab === 'preview' && (
              <div className="mb-8">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">Preview Logbook</h2>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">Tampilkan</label>
                      <select
                        className="border border-gray-300 rounded px-2 py-1 text-sm"
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">Dari</label>
                      <input type="date" className="border border-gray-300 rounded px-2 py-1 text-sm" value={filterStartDate} onChange={(e) => setFilterStartDate(e.target.value)} />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">Sampai</label>
                      <input type="date" className="border border-gray-300 rounded px-2 py-1 text-sm" value={filterEndDate} onChange={(e) => setFilterEndDate(e.target.value)} />
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={includeImages}
                        onChange={(e) => setIncludeImages(e.target.checked)}
                      />
                      Sertakan gambar saat generate
                    </label>
                    <button
                      onClick={handleGenerateWord}
                      disabled={isGenerating || filteredEntries.length === 0}
                      className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGenerating ? 'Generating...' : 'Generate Word Document'}
                    </button>
                  </div>
                </div>

                <div className="mb-3 text-sm text-gray-700 flex flex-wrap gap-4">
                  <span>
                    Total durasi semua kegiatan: <span className="font-semibold">{totalHours} jam {totalRemainderMinutes} menit</span>
                  </span>
                  <span>
                    Total hari unik: <span className="font-semibold">{uniqueDatesCount} hari</span>
                  </span>
                </div>

                {filteredEntries.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-gray-500 text-lg">Belum ada kegiatan yang ditambahkan.</div>
                    <p className="text-gray-400 mt-2">Tambahkan kegiatan pada tab "Tambah Kegiatan" untuk mulai membuat logbook.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="text-sm text-gray-600 mb-2">Menampilkan {pageStartIndex + 1}-{pageEndIndex} dari {filteredEntries.length} entri</div>
                    <table className="min-w-full border-collapse border border-gray-400">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-gray-400 px-4 py-3 text-center font-bold text-gray-900">NO.</th>
                          <th className="border border-gray-400 px-4 py-3 text-center font-bold text-gray-900">HARI/TGL</th>
                          <th className="border border-gray-400 px-4 py-3 text-center font-bold text-gray-900">JAM</th>
                          <th className="border border-gray-400 px-4 py-3 text-center font-bold text-gray-900">KEGIATAN PER HARI</th>
                          <th className="border border-gray-400 px-4 py-3 text-center font-bold text-gray-900">AKSI</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageEntries.map((entry, index) => (
                          <tr key={entry.id} className="hover:bg-gray-50">
                            <td className="border border-gray-400 px-4 py-3 text-center">{pageStartIndex + index + 1}</td>
                            <td className="border border-gray-400 px-4 py-3 text-center">{formatTanggal(entry.tanggal)}</td>
                            <td className="border border-gray-400 px-4 py-3 text-center">{entry.jam}</td>
                            <td className="border border-gray-400 px-4 py-3">
                              <div className="space-y-3">
                                <div>
                                  <p className="font-bold text-gray-900">Judul Kegiatan:</p>
                                  <p className="ml-4">• {entry.judul_kegiatan}</p>
                                </div>
                                
                                <div>
                                  <p className="font-bold text-gray-900">Rincian Kegiatan:</p>
                                  <p className="ml-4">• {entry.rincian_kegiatan}</p>
                                </div>
                                
                                {entry.dokumen_pendukung && (
                                  <div>
                                    <p className="font-bold text-gray-900">Dokumen Pendukung:</p>
                                    <div className="ml-4 mt-2">
                                      <img 
                                        src={entry.dokumen_pendukung} 
                                        alt="Dokumen Pendukung" 
                                        className="max-w-xs h-32 object-cover rounded-md border"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="border border-gray-400 px-4 py-3 text-center">
                              <div className="space-y-2">
                                <button
                                  onClick={() => handleEdit(entry)}
                                  className="bg-yellow-500 text-white px-3 py-1 rounded text-sm hover:bg-yellow-600 transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDelete(entry.id)}
                                  className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600 transition-colors"
                                >
                                  Hapus
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-between mt-3 text-sm">
                      <span>Halaman {currentPage} dari {totalPages}</span>
                      <div className="flex gap-2">
                        <button
                          className="px-3 py-1 border rounded disabled:opacity-50"
                          disabled={currentPage <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Sebelumnya
                        </button>
                        <button
                          className="px-3 py-1 border rounded disabled:opacity-50"
                          disabled={currentPage >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Selanjutnya
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;