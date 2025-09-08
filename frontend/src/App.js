import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [entries, setEntries] = useState([]);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState(null);
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
      setEntries(JSON.parse(savedEntries));
    }
  }, []);

  // Save to localStorage whenever entries change (but not on initial load)
  useEffect(() => {
    // Only save if entries is not empty or if we've loaded data
    const savedEntries = localStorage.getItem('logbook_entries');
    if (entries.length > 0 || savedEntries) {
      localStorage.setItem('logbook_entries', JSON.stringify(entries));
    }
  }, [entries]);

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
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/generate-word`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entries }),
      });

      if (!response.ok) {
        throw new Error('Gagal generate dokumen Word');
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
      alert('Terjadi kesalahan saat generate dokumen Word');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg overflow-hidden">
          <div className="bg-blue-600 px-6 py-4">
            <h1 className="text-2xl font-bold text-white">Generator Logbook Otomatis</h1>
            <p className="text-blue-100 mt-1">Buat dokumen logbook dalam format Word secara otomatis</p>
          </div>

          <div className="p-6">
            {/* Form Input */}
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

            {/* Preview Logbook */}
            {entries.length > 0 && (
              <div className="mb-8">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-semibold text-gray-900">Preview Logbook</h2>
                  <button
                    onClick={handleGenerateWord}
                    disabled={isGenerating}
                    className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGenerating ? 'Generating...' : 'Generate Word Document'}
                  </button>
                </div>

                <div className="overflow-x-auto">
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
                      {entries.map((entry, index) => (
                        <tr key={entry.id} className="hover:bg-gray-50">
                          <td className="border border-gray-400 px-4 py-3 text-center">{index + 1}</td>
                          <td className="border border-gray-400 px-4 py-3 text-center">{entry.tanggal}</td>
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
              </div>
            )}

            {entries.length === 0 && (
              <div className="text-center py-8">
                <div className="text-gray-500 text-lg">
                  Belum ada kegiatan yang ditambahkan.
                </div>
                <p className="text-gray-400 mt-2">
                  Tambahkan kegiatan menggunakan form di atas untuk mulai membuat logbook.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;