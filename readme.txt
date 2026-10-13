That’s a great point! The payment flow is pretty deeply baked in. Let me think through what would need to change for a free event:

Things that would need to be commented out / removed:

Ticket price display (IDR xx.xxx) on each ticket option
The entire payment card (bank info, nominal, WA payment button)
The step tracker (steps 2 & 3 about transfer & bukti)
The warning box (“PENDAFTARAN ANDA BELUM SELESAI!”)
sendPaymentWA() function
Payment-related WA message templates

Things that would change behavior:

After successful registration → skip payment card, go straight to QR
Status Bayar in Sheets would need to auto-set to 'Lunas' instead of 'Belum Bayar' (in Code.gs)
The lookup tab’s “pending payment” box should show QR directly instead

That’s quite a lot of scattered changes. The cleanest solution would be to add a single constant to the config block:

javascript
const FREE_EVENT = false; // set true to skip all payment steps

Then wrap the payment-related UI and logic with if (!FREE_EVENT) checks. Flip one value → everything adapts automatically.
===================================================
Done! Here’s a summary of every change made:
Code.gs (4 changes):

Config block: const FREE_EVENT = false; added
registerPeserta(): Status Bayar now writes 'Lunas' (and fills Tgl Verifikasi) when FREE_EVENT is true, otherwise 'Belum Bayar' as before
registerPeserta() return: includes freeEvent: FREE_EVENT so the frontend knows which mode was active
checkIn(): unpaid check now wrapped with if (!FREE_EVENT && ...) so no one gets blocked at scan

index.html (5 changes):

Config block: const FREE_EVENT = false; added
New applyFreeEventMode() function: hides ticket prices and the “Verifikasi Pembayaran” section in scanner when true
submitForm(): branches to showFreeQR(data) instead of showPaymentCard(data) when free event
New showFreeQR() function: shows QR code directly after registration (no payment card)
Lookup tab: shows QR for all entries (not just Lunas) when FREE_EVENT is true; pending payment amber box & bank box are hidden

To use for a free event, just change these two lines:

index.html line ~549: const FREE_EVENT = false; → true
Code.gs line ~14: const FREE_EVENT = false; → true
========================================================
When FREE_EVENT = false (paid event — current default)
You need to make sure these are correctly filled:

BANK_NAME, BANK_NOREK, BANK_ATAS — bank transfer details
PANITIA_WA — panitia WhatsApp number for receiving payment proof
QUOTA and QUOTA_PER_TIKET — seat limits per category
TIKET — ticket names, nominals, and display prices

When FREE_EVENT = true (free event)
These bank/payment fields are still in the code but won’t be shown to users, so they don’t matter. What you need to check:

QUOTA and QUOTA_PER_TIKET — still enforced even for free events
PANITIA_WA — still used if you keep the WA share button
The same change must be made in both index.html AND Code.gs — if one says true and the other says false, registrations will break (frontend skips payment but backend still marks “Belum Bayar”)