(() => {
  const $ = (id) => document.getElementById(id);
  const token = () => window.__API_TOKEN__ || '';
  const text = (node, value) => { node.textContent = value == null ? '' : String(value); };
  let currentSession = null;
  async function refresh() {
    try {
      const response = await fetch('/api/expedition/latest', { headers: { 'X-Api-Token': token() } });
      const data = await response.json();
      const snapshot = data.snapshot;
      if (!snapshot) return;
      currentSession = snapshot.session_id;
      text($('area'), snapshot.area_name || 'Expedition');
      text($('meta'), `${snapshot.stations.length} Rune Station · Map Lv ${snapshot.area_level || '?'}`);
      text($('updated'), snapshot.scan_unix ? new Date(snapshot.scan_unix * 1000).toLocaleTimeString('vi-VN') : 'Đang cập nhật');
      const root = $('stations'); root.replaceChildren();
      if (!snapshot.stations.length) { const empty = document.createElement('div'); empty.className='empty'; text(empty,'Chưa phát hiện Rune Station trong map này.'); root.append(empty); return; }
      snapshot.stations.forEach((station) => {
        const card = document.createElement('section'); card.className='station';
        const head = document.createElement('div'); head.className='station-head';
        const title = document.createElement('span'); title.className='station-title'; text(title, `${station.station.label} · ${station.station.slot_count} slot`);
        const value = document.createElement('span'); value.className='station-value'; text(value, station.best_value_exalted == null ? 'Chưa có giá' : `≈ ${station.best_value_exalted.toFixed(2)} Ex`);
        head.append(title,value); card.append(head);
        station.combinations.forEach((combo) => { const row=document.createElement('div'); row.className='combo'; const info=document.createElement('div'); const reward=document.createElement('div'); reward.className='reward'; text(reward,`${combo.reward_count}× ${combo.reward}`); const runes=document.createElement('div'); runes.className='runes'; text(runes,combo.runes.join(' · ')); info.append(reward,runes); const price=document.createElement('div'); price.className='price'; text(price,combo.value_exalted==null?'—':`${combo.value_exalted.toFixed(2)} Ex`); row.append(info,price); card.append(row); });
        root.append(card);
      });
    } catch (_) { /* transient loading/area changes are expected */ }
  }
  window.refreshExpedition = refresh;
  $('close').addEventListener('click', async () => { if (currentSession) await fetch('/api/expedition/dismiss',{method:'POST',headers:{'Content-Type':'application/json','X-Api-Token':token()},body:JSON.stringify({session_id:currentSession})}); window.ipc?.postMessage('hide-expedition'); });
  window.addEventListener('keydown',(event)=>{if(event.key==='Escape')$('close').click();});
  const pollLoop = async () => {
    await refresh();
    window.setTimeout(pollLoop, document.hidden ? 5000 : 900);
  };
  pollLoop();
})();
