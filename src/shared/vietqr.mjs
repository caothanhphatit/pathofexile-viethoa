// VietQR (NAPAS 247) payload: the EMVCo text a banking app reads from the QR to prefill
// the receiving account, the amount and the transfer content.

const field = (id, value) => {
  const text = String(value);
  return `${id}${String(text.length).padStart(2, "0")}${text}`;
};

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over the ASCII text, as 4 upper-case hex digits. */
export function crc16(text) {
  let crc = 0xffff;
  for (let i = 0; i < text.length; i += 1) {
    crc ^= text.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Payload for a transfer to a bank account. `bin` is the bank's 6-digit NAPAS BIN,
 * `amount` whole VND (omitted when not positive), `content` ASCII transfer content.
 * Returns "" when the bank or account is not usable.
 */
export function vietQrPayload({ bin, account, amount, content } = {}) {
  const bankBin = String(bin || "").trim();
  const accountNo = String(account || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(bankBin) || !/^[A-Za-z0-9]{4,19}$/.test(accountNo)) return "";
  const info = String(content || "").replace(/[^\x20-\x7e]/g, "").trim().slice(0, 50);
  const value = Math.floor(Number(amount) || 0);
  const beneficiary = field("00", bankBin) + field("01", accountNo);
  const merchant = field("00", "A000000727") + field("01", beneficiary) + field("02", "QRIBFTTA");
  let payload = field("00", "01")
    // 12 = one-time QR (amount fixed), 11 = reusable.
    + field("01", value > 0 ? "12" : "11")
    + field("38", merchant)
    + field("53", "704");
  if (value > 0) payload += field("54", String(value));
  payload += field("58", "VN");
  if (info) payload += field("62", field("08", info));
  payload += "6304";
  return payload + crc16(payload);
}
