function field(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

function crc16(value: string): string {
  let crc = 0xffff;
  for (const character of value) {
    crc ^= character.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function promptPayPayload(promptPayId: string, amount: number): string {
  const digits = promptPayId.replace(/\D/g, "");
  const proxy = digits.length === 10 && digits.startsWith("0")
    ? field("01", `0066${digits.slice(1)}`)
    : digits.length === 13
      ? field("02", digits)
      : "";
  if (!proxy) throw new Error("พร้อมเพย์ต้องเป็นเบอร์โทรศัพท์ 10 หลักหรือเลขประจำตัว 13 หลัก");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("ยอดชำระไม่ถูกต้อง");

  const merchant = field("00", "A000000677010111") + proxy;
  const body = field("00", "01")
    + field("01", "12")
    + field("29", merchant)
    + field("58", "TH")
    + field("53", "764")
    + field("54", amount.toFixed(2))
    + "6304";
  return body + crc16(body);
}

export function maskPromptPayId(promptPayId: string): string {
  const digits = promptPayId.replace(/\D/g, "");
  if (digits.length <= 6) return digits;
  return `${digits.slice(0, 3)}${"•".repeat(digits.length - 6)}${digits.slice(-3)}`;
}
