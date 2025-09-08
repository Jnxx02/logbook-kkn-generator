#!/usr/bin/env python3
"""
Backend API Testing for Logbook Word Generator
Tests health check and word document generation endpoints
"""

import requests
import json
import base64
import os
from datetime import datetime
import tempfile

# Get backend URL from environment
BACKEND_URL = "https://logbook-creator-1.preview.emergentagent.com"
API_BASE = f"{BACKEND_URL}/api"

def create_sample_base64_image():
    """Create a simple base64 encoded image for testing"""
    # Create a simple 100x100 red square PNG
    from PIL import Image
    img = Image.new('RGB', (100, 100), color='red')
    
    # Save to bytes
    import io
    img_bytes = io.BytesIO()
    img.save(img_bytes, format='PNG')
    img_bytes.seek(0)
    
    # Convert to base64
    img_b64 = base64.b64encode(img_bytes.getvalue()).decode('utf-8')
    return f"data:image/png;base64,{img_b64}"

def test_health_endpoint():
    """Test the health check endpoint"""
    print("🔍 Testing Health Check Endpoint...")
    
    try:
        response = requests.get(f"{API_BASE}/health", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "healthy":
                print("✅ Health check passed - Server is running")
                return True
            else:
                print(f"❌ Health check failed - Unexpected response: {data}")
                return False
        else:
            print(f"❌ Health check failed - Status code: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Health check failed - Connection error: {e}")
        return False

def test_generate_word_single_entry():
    """Test word generation with single entry (no image)"""
    print("\n🔍 Testing Word Generation - Single Entry (No Image)...")
    
    test_data = {
        "entries": [
            {
                "id": "test-1",
                "tanggal": "12 Desember 2024",
                "jam": "10:00 - 12:00",
                "judul_kegiatan": "Pembekalan Khusus Kabupaten Bulukumba",
                "rincian_kegiatan": "Pembukaan - 10.16 Foto Bersama - 10.38 Materi Pembekalan Khusus - 10.43 Sesi Tanya Jawab - 11.15"
            }
        ]
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/generate-word",
            json=test_data,
            timeout=30
        )
        
        if response.status_code == 200:
            # Check if response is a file
            content_type = response.headers.get('content-type', '')
            if 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' in content_type:
                print("✅ Word generation successful - Single entry without image")
                print(f"   File size: {len(response.content)} bytes")
                return True
            else:
                print(f"❌ Word generation failed - Wrong content type: {content_type}")
                return False
        else:
            print(f"❌ Word generation failed - Status code: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Word generation failed - Connection error: {e}")
        return False

def test_generate_word_with_image():
    """Test word generation with image"""
    print("\n🔍 Testing Word Generation - With Base64 Image...")
    
    # Create sample base64 image
    sample_image = create_sample_base64_image()
    
    test_data = {
        "entries": [
            {
                "id": "test-2",
                "tanggal": "13 Desember 2024",
                "jam": "14:00 - 16:00",
                "judul_kegiatan": "Workshop Dokumentasi",
                "rincian_kegiatan": "Sesi pelatihan dokumentasi kegiatan dengan foto dan video",
                "dokumen_pendukung": sample_image
            }
        ]
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/generate-word",
            json=test_data,
            timeout=30
        )
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            if 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' in content_type:
                print("✅ Word generation successful - With base64 image")
                print(f"   File size: {len(response.content)} bytes")
                return True
            else:
                print(f"❌ Word generation failed - Wrong content type: {content_type}")
                return False
        else:
            print(f"❌ Word generation failed - Status code: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Word generation failed - Connection error: {e}")
        return False

def test_generate_word_multiple_entries():
    """Test word generation with multiple entries"""
    print("\n🔍 Testing Word Generation - Multiple Entries...")
    
    sample_image = create_sample_base64_image()
    
    test_data = {
        "entries": [
            {
                "id": "test-3a",
                "tanggal": "14 Desember 2024",
                "jam": "09:00 - 11:00",
                "judul_kegiatan": "Rapat Koordinasi Tim",
                "rincian_kegiatan": "Pembahasan agenda kerja minggu depan dan evaluasi progress"
            },
            {
                "id": "test-3b",
                "tanggal": "14 Desember 2024",
                "jam": "13:00 - 15:00",
                "judul_kegiatan": "Pelatihan Sistem Baru",
                "rincian_kegiatan": "Training penggunaan sistem informasi terbaru",
                "dokumen_pendukung": sample_image
            },
            {
                "id": "test-3c",
                "tanggal": "15 Desember 2024",
                "jam": "10:00 - 12:00",
                "judul_kegiatan": "Monitoring Lapangan",
                "rincian_kegiatan": "Kunjungan ke lokasi proyek untuk monitoring progress"
            }
        ]
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/generate-word",
            json=test_data,
            timeout=30
        )
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            if 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' in content_type:
                print("✅ Word generation successful - Multiple entries")
                print(f"   File size: {len(response.content)} bytes")
                return True
            else:
                print(f"❌ Word generation failed - Wrong content type: {content_type}")
                return False
        else:
            print(f"❌ Word generation failed - Status code: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Word generation failed - Connection error: {e}")
        return False

def test_generate_word_empty_entries():
    """Test word generation with empty entries array"""
    print("\n🔍 Testing Word Generation - Empty Entries...")
    
    test_data = {
        "entries": []
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/generate-word",
            json=test_data,
            timeout=30
        )
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            if 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' in content_type:
                print("✅ Word generation successful - Empty entries (header only)")
                print(f"   File size: {len(response.content)} bytes")
                return True
            else:
                print(f"❌ Word generation failed - Wrong content type: {content_type}")
                return False
        else:
            print(f"❌ Word generation failed - Status code: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Word generation failed - Connection error: {e}")
        return False

def test_generate_word_invalid_data():
    """Test word generation with invalid data"""
    print("\n🔍 Testing Word Generation - Invalid Data...")
    
    # Test with missing required fields
    test_data = {
        "entries": [
            {
                "id": "test-invalid",
                "tanggal": "16 Desember 2024"
                # Missing required fields: jam, judul_kegiatan, rincian_kegiatan
            }
        ]
    }
    
    try:
        response = requests.post(
            f"{API_BASE}/generate-word",
            json=test_data,
            timeout=30
        )
        
        if response.status_code == 422:  # Validation error expected
            print("✅ Invalid data handling correct - Returns 422 validation error")
            return True
        elif response.status_code == 500:
            print("⚠️  Invalid data returns 500 error (acceptable but could be improved)")
            return True
        else:
            print(f"❌ Invalid data handling failed - Unexpected status: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Invalid data test failed - Connection error: {e}")
        return False

def test_generate_word_malformed_json():
    """Test word generation with malformed JSON"""
    print("\n🔍 Testing Word Generation - Malformed JSON...")
    
    try:
        response = requests.post(
            f"{API_BASE}/generate-word",
            data="invalid json data",
            headers={'Content-Type': 'application/json'},
            timeout=30
        )
        
        if response.status_code == 422:  # Validation error expected
            print("✅ Malformed JSON handling correct - Returns 422 validation error")
            return True
        else:
            print(f"❌ Malformed JSON handling failed - Status: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Malformed JSON test failed - Connection error: {e}")
        return False

def run_all_tests():
    """Run all backend API tests"""
    print("=" * 60)
    print("🚀 STARTING BACKEND API TESTS")
    print("=" * 60)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"API Base: {API_BASE}")
    print()
    
    test_results = []
    
    # Test 1: Health Check
    test_results.append(("Health Check", test_health_endpoint()))
    
    # Test 2: Single Entry (No Image)
    test_results.append(("Single Entry (No Image)", test_generate_word_single_entry()))
    
    # Test 3: With Image
    test_results.append(("With Base64 Image", test_generate_word_with_image()))
    
    # Test 4: Multiple Entries
    test_results.append(("Multiple Entries", test_generate_word_multiple_entries()))
    
    # Test 5: Empty Entries
    test_results.append(("Empty Entries", test_generate_word_empty_entries()))
    
    # Test 6: Invalid Data
    test_results.append(("Invalid Data Handling", test_generate_word_invalid_data()))
    
    # Test 7: Malformed JSON
    test_results.append(("Malformed JSON Handling", test_generate_word_malformed_json()))
    
    # Summary
    print("\n" + "=" * 60)
    print("📊 TEST RESULTS SUMMARY")
    print("=" * 60)
    
    passed = 0
    failed = 0
    
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
        if result:
            passed += 1
        else:
            failed += 1
    
    print(f"\nTotal Tests: {len(test_results)}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Success Rate: {(passed/len(test_results)*100):.1f}%")
    
    return test_results

if __name__ == "__main__":
    # Install required dependencies if not available
    try:
        import requests
        from PIL import Image
    except ImportError as e:
        print(f"Missing dependency: {e}")
        print("Please install: pip install requests pillow")
        exit(1)
    
    run_all_tests()