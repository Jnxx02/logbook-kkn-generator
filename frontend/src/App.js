import React, { useState, useEffect } from 'react';
import './App.css';

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
    dokumen_pendukung: null
  });
  const [isGenerating, setIsGenerating] = useState(false);

  // Load data from localStorage on component mount
  useEffect(() => {
    const savedEntries = localStorage.getItem('logbook_entries');
    if (savedEntries) {
      try {
        setEntries(JSON.parse(savedEntries));
      } catch (error) {
        console.error('Error parsing localStorage data:', error);
      }
    }
    setIsInitialized(true);
  }, []);

  // Save to localStorage whenever entries change (but not on initial load)
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem('logbook_entries', JSON.stringify(entries));
    }
  }, [entries, isInitialized]);

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
      reader.onload = (e) => {
        setFormData(prev => ({
          ...prev,
          dokumen_pendukung: e.target.result
        }));
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

    if (isEditing) {
      // Update existing entry
      setEntries(prev => prev.map(entry => 
        entry.id === editingId 
          ? { ...formData, jam: jamCombined, id: editingId }
          : entry
      ));
      setIsEditing(false);
      setEditingId(null);
    } else {
      // Add new entry
      const newEntry = {
        ...formData,
        jam: jamCombined,
        id: Date.now().toString()
      };
      setEntries(prev => [...prev, newEntry]);
    }

    // Reset form
    setFormData({
      tanggal: '',
      jam_mulai: '',
      jam_selesai: '',
      judul_kegiatan: '',
      rincian_kegiatan: '',
      dokumen_pendukung: null
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
      dokumen_pendukung: entry.dokumen_pendukung
    });
    setIsEditing(true);
    setEditingId(entry.id);
    setActiveTab('form');
  };

  const handleDelete = (id) => {
    if (window.confirm('Yakin ingin menghapus kegiatan ini?')) {
      setEntries(prev => prev.filter(entry => entry.id !== id));
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
      dokumen_pendukung: null
    });
    const fileInput = document.getElementById('dokumen_pendukung');
    if (fileInput) fileInput.value = '';
  };

  const handleGenerateWord = async () => {
    if (entries.length === 0) {
      alert('Tidak ada kegiatan untuk di-generate. Tambahkan kegiatan terlebih dahulu.');
      return;
    }

    setIsGenerating(true);
    try {
      const baseUrl = process.env.REACT_APP_BACKEND_URL || '';
      const response = await fetch(`${baseUrl}/api/generate-word`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entries }),
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

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          <div className="bg-yellow-50 border-b border-yellow-200 px-6 py-3">
            <p className="text-sm text-yellow-800">
              Pemberitahuan: Data logbook disimpan di localStorage browser ini saja. Jika dibuka di browser lain, datanya tidak akan tersedia.
            </p>
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
                    <button
                      onClick={handleGenerateWord}
                      disabled={isGenerating || entries.length === 0}
                      className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isGenerating ? 'Generating...' : 'Generate Word Document'}
                    </button>
                  </div>
                </div>

                {entries.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-gray-500 text-lg">Belum ada kegiatan yang ditambahkan.</div>
                    <p className="text-gray-400 mt-2">Tambahkan kegiatan pada tab "Tambah Kegiatan" untuk mulai membuat logbook.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="text-sm text-gray-600 mb-2">Menampilkan {Math.min(entries.length, pageSize)} dari {entries.length} entri</div>
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
                        {entries.slice(0, pageSize).map((entry, index) => (
                          <tr key={entry.id} className="hover:bg-gray-50">
                            <td className="border border-gray-400 px-4 py-3 text-center">{index + 1}</td>
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