@echo off
:: 1. Tạo thư mục certs nếu chưa có
if not exist "..\certs" mkdir ..\certs
cd ..\certs

:: 2. Kiểm tra xem lệnh openssl có tồn tại không
where openssl >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] Khong tim thay lenh 'openssl' trong he thong (PATH).
    echo Vui long cai dat Git hoac OpenSSL va thu lai.
    pause
    exit /b
)

:: 3. Chạy lệnh tạo chứng chỉ
echo Dang tao chung chi (cert.pem & key.pem)...
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes ^
    -subj "/C=VN/ST=HCM/L=District5/O=VNU-HCMUS/OU=IT/CN=localhost"

echo.
echo [THANH CONG] Chung chi da duoc tao tai thu muc certs/
pause
