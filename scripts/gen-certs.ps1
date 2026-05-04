# 1. Định nghĩa thư mục lưu trữ (tương đối từ thư mục scripts/)
$CertDir = "..\certs"

# 2. Tạo thư mục certs nếu chưa tồn tại
if (-not (Test-Path -Path $CertDir)) {
    New-Item -ItemType Directory -Path $CertDir | Out-Null
    Write-Host "-> Da tao thu muc $CertDir" -ForegroundColor Cyan
}

# 3. Kiểm tra xem lệnh 'openssl' có tồn tại trong PATH không
if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: Khong tim thay lenh 'openssl' trong he thong." -ForegroundColor Red
    Write-Host "Vui long cai dat OpenSSL hoac Git Bash va them vao bien moi truong PATH."
    Read-Host "Nhan Enter de thoat..."
    exit
}

# 4. Chạy lệnh OpenSSL để tạo cert
Write-Host "-> Dang tao chung chi (cert.pem & key.pem)..." -ForegroundColor Yellow

openssl req -x509 -newkey rsa:4096 -keyout "$CertDir/key.pem" -out "$CertDir/cert.pem" -days 365 -nodes `
    -subj "/C=VN/ST=HCM/L=District5/O=VNU-HCMUS/OU=IT/CN=localhost"

# 5. Thông báo hoàn tất
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[THANH CONG] Chung chi da duoc tao tai thu muc: $CertDir/" -ForegroundColor Green
} else {
    Write-Host "`n[LOI] Co loi xay ra trong qua trinh tao chung chi." -ForegroundColor Red
}

Read-Host "Nhan Enter de tiep tuc..."
