SELECT b.id, b.public_id, b.status, b.payment_status, b.quoted_price, b.payment_deadline_at, b.starts_at, b.ends_at,
       b.availability_slot_id, s.state AS slot_state
FROM bookings b
LEFT JOIN availability_slots s ON s.id = b.availability_slot_id
WHERE b.public_id = @booking_public_id;

SELECT h.id, h.from_status, h.to_status, h.note, h.created_at
FROM booking_status_history h
JOIN bookings b ON b.id = h.booking_id
WHERE b.public_id = @booking_public_id
ORDER BY h.id;

SELECT p.id, p.amount, p.status, p.review_note, p.submitted_at, p.reviewed_at
FROM payments p
JOIN bookings b ON b.id = p.booking_id
WHERE b.public_id = @booking_public_id
ORDER BY p.id;

SELECT cr.id AS chat_room_id, m.id AS message_id, m.message_text, m.attachment_mime, m.attachment_name, m.attachment_size, m.created_at
FROM chat_rooms cr
JOIN bookings b ON b.id = cr.booking_id
LEFT JOIN messages m ON m.chat_room_id = cr.id
WHERE b.public_id = @booking_public_id
ORDER BY m.id;

SELECT r.id, r.rating, r.comment, r.status, r.created_at
FROM reviews r
JOIN bookings b ON b.id = r.booking_id
WHERE b.public_id = @booking_public_id;
