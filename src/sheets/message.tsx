// Every WhatsApp message is shown first, the way it will look in the chat, and can be changed
// before it is sent: receipts, delivery notes, the list of days, reminders.
import { Copy, Send } from 'lucide-react';
import { useState } from 'react';
import { Button, Field, Sheet, SheetButtons, TextArea, useNotice } from '../components/ui';
import { whatsappLink } from '../lib/reminders';

export function MessagePreview({ title, to, phone, text, onClose }: { title: string; to?: string; phone?: string; text: string; onClose: () => void }) {
  const notify = useNotice();
  const [msg, setMsg] = useState(text);
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            variant="plain"
            icon={Copy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(msg);
                notify('Message copied');
              } catch {
                notify('Copying is not allowed here: select the text and copy it', 'info');
              }
            }}
          >
            Copy
          </Button>
          <Button
            icon={Send}
            disabled={!msg.trim()}
            onClick={() => {
              window.open(whatsappLink(phone, msg), '_blank');
              onClose();
            }}
          >
            Send on WhatsApp
          </Button>
        </SheetButtons>
      }
    >
      <p className="mb-2 text-sm text-muted">
        To <b className="text-ink">{to || 'the person you choose'}</b>
        {phone ? ` · ${phone}` : ' · no phone saved: WhatsApp asks which chat'}
      </p>
      <div className="rounded-2xl p-3" style={{ background: '#EFE7DD' }}>
        <div className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm px-3 py-2 text-[15px] leading-snug whitespace-pre-wrap shadow-sm" style={{ background: '#D9FDD3', color: '#111B21' }}>
          {msg || ' '}
          <span className="mt-1 block text-right text-[11px]" style={{ color: '#667781' }}>
            {time} ✓✓
          </span>
        </div>
      </div>
      <Field label="The message (change it if you like)" className="mt-3">
        <TextArea rows={Math.min(10, Math.max(3, msg.split('\n').length + 1))} value={msg} onChange={(e) => setMsg(e.target.value)} />
      </Field>
      <p className="mt-2 text-xs text-muted">Nothing is sent until you tap Send on WhatsApp; WhatsApp then opens with this message ready, and you press its send button.</p>
    </Sheet>
  );
}
