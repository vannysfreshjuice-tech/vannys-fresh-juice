// The statement card window: a picture of where the customer stands, ready to send on WhatsApp.
import { Download, List, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSheets } from '../components/SheetHost';
import { Button, Sheet, SheetButtons, useNotice } from '../components/ui';
import { useData } from '../data/DataContext';
import { fromYmd } from '../lib/dates';
import { debtsOf } from '../lib/juice';
import { standing, statementText } from '../lib/performance';
import { whatsappLink } from '../lib/reminders';
import { drawStatementCard } from '../lib/statementCard';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (ymd: string) => {
  const d = fromYmd(ymd);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export function StatementCardSheet({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { customersById, customerBal, customerAdv, orders, sales, byRef, settings, today } = useData();
  const notify = useNotice();
  const sheets = useSheets();
  const c = customersById.get(customerId);
  const owes = customerBal.get(customerId) ?? 0;
  const ahead = customerAdv.get(customerId) ?? 0;
  const bottlePrice = settings.sizes.find((s) => s.key === '500')?.price ?? settings.sizes[0]?.price ?? 0;
  const st = standing(owes, ahead, bottlePrice);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const name = c?.name ?? '';

  useEffect(() => {
    if (!c) return;
    let gone = false;
    let made = '';
    drawStatementCard({ businessName: settings.businessName, customerName: name, standing: st, currency: settings.currency, dateText: longDate(today), whatsapp: settings.whatsapp, phone: settings.phone, merchantCode: settings.merchantCode, note: settings.receiptNote })
      .then((b) => {
        if (gone) return;
        made = URL.createObjectURL(b);
        setBlob(b);
        setUrl(made);
      })
      .catch((e) => setErr((e as Error).message));
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
    // redraw only when the figure or the customer changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, st.kind, st.amount, today]);

  if (!c) return null;
  const fileName = `${settings.businessName.replace(/[^\w]+/g, '-')}-statement-${name.replace(/[^\w]+/g, '-')}.png`.toLowerCase();
  const caption = `Hi ${name}, here is your statement from ${settings.businessName}.`;
  const send = async () => {
    if (!blob) return;
    const file = new File([blob], fileName, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], text: caption });
        return;
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
      }
    }
    // No picture sharing here (a laptop): save the picture and open WhatsApp to attach it.
    save();
    window.open(whatsappLink(c.phone, `${caption} (picture attached)`), '_blank');
    notify('The card is saved: attach it in WhatsApp', 'info');
  };
  const save = () => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  const asText = () => sheets.swap({ t: 'message', title: `Statement for ${name}`, to: name, phone: c.phone, text: statementText(name, debtsOf(customerId, orders, sales, byRef), owes, ahead, settings) });
  return (
    <Sheet
      title={`Statement for ${name}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button variant="plain" icon={Download} disabled={!blob} onClick={save}>
            Save picture
          </Button>
          <Button icon={Send} disabled={!blob} onClick={send}>
            Send on WhatsApp
          </Button>
        </SheetButtons>
      }
    >
      {err ? (
        <p className="rounded-xl bg-cherry-soft px-3 py-2 text-sm text-cherry">{err}</p>
      ) : url ? (
        <img src={url} alt={`Statement card for ${name}`} className="mx-auto w-full max-w-sm rounded-2xl shadow-lg" />
      ) : (
        <p className="py-16 text-center text-sm text-muted">Making the card…</p>
      )}
      <p className="mt-3 text-center text-xs text-muted">One figure only: what they owe less anything paid ahead. On a phone, Send opens the share list: choose WhatsApp, then the customer.</p>
      <div className="mt-2 text-center">
        <Button small variant="plain" icon={List} onClick={asText}>
          Send the list of days instead
        </Button>
      </div>
    </Sheet>
  );
}
