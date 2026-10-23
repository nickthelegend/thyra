// Fills the door schedule and the room-summary readout from data/schedule.json,
// which scripts/landing-data.ts builds from real e2e run files (deployments/e2e).
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function main() {
  const tbody = document.getElementById('doors');
  try {
    const res = await fetch('data/schedule.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const keys = ['Tag', 'Room', 'Door', 'Destination', 'Plan', 'Image', 'pano_mode', 'To world', 'Off-plane'];
    tbody.innerHTML = data.rows.length
      ? data.rows
          .map((r) => {
            const cells = [
              `<td class="tagcell" data-k="${keys[0]}">${esc(r.tag)}</td>`,
              `<td data-k="${keys[1]}">${esc(r.room)}</td>`,
              `<td class="mono" data-k="${keys[2]}">${esc(r.door)}</td>`,
              `<td data-k="${keys[3]}">${esc(r.destination)}</td>`,
              `<td class="mono" data-k="${keys[4]}">${esc(r.plan)}</td>`,
              `<td data-k="${keys[5]}"><span class="stamp">${esc(r.image)}</span></td>`,
              `<td class="mono" data-k="${keys[6]}">${esc(r.pano_mode)}</td>`,
              `<td class="mono" data-k="${keys[7]}">${esc(r.to_world)}</td>`,
              `<td class="mono" data-k="${keys[8]}">${esc(r.off_plane)}</td>`,
            ];
            return `<tr>${cells.join('')}</tr>`;
          })
          .join('')
      : '<tr><td colspan="9">No runs recorded yet.</td></tr>';
    document.getElementById('schedule-src').textContent = `Source: ${data.source} · ${data.passed}/${data.total} e2e checks passed`;
    document.getElementById('summary').textContent = JSON.stringify(data.summary, null, 2);
    document.getElementById('summary-src').textContent = data.summary_from;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9">Could not load the run data (${esc(err.message)}).</td></tr>`;
    document.getElementById('summary').textContent = 'Could not load the run data.';
  }
}
main();

// Reduced motion: keep the hero clip paused on its first frame.
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const v = document.getElementById('hero-video');
  v.removeAttribute('autoplay');
  v.pause();
}
