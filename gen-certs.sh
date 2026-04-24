#!/bin/bash
mkdir -p certs
cd certs

openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes \
    -subj "/C=VN/ST=HCM/L=District5/O=VNU-HCMUS/OU=IT/CN=localhost"

echo "Đã tạo xong cert.pem và key.pem trong thư mục certs/"