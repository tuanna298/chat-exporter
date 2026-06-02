# Chat Exporter — Hướng dẫn cài đặt

Xuất lịch sử chat từ **Instagram DM** và **Zalo Web** về máy tính của bạn.

---

## Tải extension

Vào trang [**Releases**](../../releases/latest) → tải file `chat-exporter-vX.X.X.zip` mới nhất.

---

## Cài đặt (Chrome / Edge)

> Thực hiện **một lần duy nhất**. Sau khi cài xong, extension tự cập nhật mỗi khi bạn reload thư mục.

**Bước 1 — Giải nén**

Giải nén file ZIP vừa tải về ra một thư mục cố định (ví dụ `Documents/chat-exporter`).
Đừng xóa hoặc di chuyển thư mục này sau khi cài.

**Bước 2 — Mở trang Extensions**

Mở Chrome, gõ vào thanh địa chỉ:
```
chrome://extensions
```

**Bước 3 — Bật Developer mode**

Góc trên bên phải, bật công tắc **Developer mode**.

**Bước 4 — Load extension**

Nhấn nút **Load unpacked** → chọn thư mục vừa giải nén ở Bước 1.

Icon 💬 sẽ xuất hiện trên thanh công cụ Chrome.

---

## Sử dụng

### Instagram DM
1. Đăng nhập Instagram, mở một cuộc trò chuyện DM
2. Nhấn icon 💬 trên thanh công cụ
3. Nhấn **Xuất cuộc trò chuyện**
4. Chờ extension tải hết tin nhắn
5. Tải về **JSON** hoặc **Markdown**

### Zalo Web
1. Mở [chat.zalo.me](https://chat.zalo.me), chọn một cuộc trò chuyện
2. Nhấn icon 💬 trên thanh công cụ
3. Nhấn **Xuất cuộc trò chuyện**
4. Chờ extension tải hết tin nhắn
5. Tải về **JSON** hoặc **Markdown**

---

## Tuỳ chỉnh (Cài đặt nâng cao)

| Tuỳ chọn | Ý nghĩa |
|---|---|
| **Tốc độ tải** | Nhanh = nhanh hơn nhưng có thể bỏ sót; Kỹ lưỡng = chậm hơn nhưng đầy đủ hơn |
| **Độ sâu** | Số lần thử khi không tìm thêm được tin nhắn mới — tăng lên nếu đoạn chat rất dài |
| **Định dạng xuất** | JSON (dữ liệu đầy đủ) hoặc Markdown (dễ đọc) |

---

## Lưu ý

- Dữ liệu **chỉ lưu trên máy bạn**, không gửi lên bất kỳ server nào.
- Extension chỉ hoạt động khi bạn đang mở đúng trang chat.
- Nếu gặp lỗi, thử **reload trang** rồi mở lại extension.

---

## Định dạng file xuất

**JSON** — Đầy đủ thông tin, dùng để import vào tool khác:
```json
[
  {
    "id": "...",
    "timestamp": "2025-01-01T10:00:00.000Z",
    "sender": "Nguyễn Văn A",
    "type": "text",
    "content": "Hello!"
  }
]
```

**Markdown** — Dễ đọc, có thể mở bằng bất kỳ text editor:
```
[2025-01-01 10:00]
**Nguyễn Văn A:**
Hello!
```
