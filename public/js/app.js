/* ==========================================================================
   EAPEX — skrip peramban
   Semua JavaScript ada di berkas ini (bukan <script> sebaris) supaya
   Content-Security-Policy bisa menolak skrip dari mana pun selain aplikasi.
   ========================================================================== */
(function () {
  'use strict';

  // -------------------------------------------------------------- pembantu uang
  function angkaDari(teks) {
    var s = String(teks == null ? '' : teks).replace(/[^\d-]/g, '');
    var n = parseInt(s, 10);
    return isFinite(n) ? n : 0;
  }
  function keRibuan(n) {
    return Number(n || 0).toLocaleString('id-ID');
  }
  function rupiah(n) { return 'Rp ' + keRibuan(n); }

  // Kolom uang: tampilkan bertitik saat diketik, kirim angka bulat saat submit.
  function pasangKolomUang(akar) {
    (akar || document).querySelectorAll('input[data-uang]').forEach(function (el) {
      if (el.dataset.terpasang) return;
      el.dataset.terpasang = '1';
      el.setAttribute('inputmode', 'numeric');
      if (el.value) el.value = keRibuan(angkaDari(el.value));
      el.addEventListener('input', function () {
        var posisiDariKanan = el.value.length - (el.selectionStart || 0);
        el.value = el.value === '' ? '' : keRibuan(angkaDari(el.value));
        var pos = Math.max(0, el.value.length - posisiDariKanan);
        try { el.setSelectionRange(pos, pos); } catch (e) { /* abaikan */ }
        hitungTotal();
      });
      el.addEventListener('blur', hitungTotal);
    });
  }

  // -------------------------------------------------------------- rincian biaya
  function barisItem() {
    return Array.prototype.slice.call(document.querySelectorAll('#tabel-item tbody tr'));
  }

  function hitungBaris(tr) {
    var qty = angkaDari((tr.querySelector('[name="item_qty[]"]') || {}).value || '0');
    var harga = angkaDari((tr.querySelector('[name="item_harga[]"]') || {}).value || '0');
    var nominal = (qty || 0) * (harga || 0);
    var sel = tr.querySelector('.nominal-baris');
    if (sel) sel.textContent = keRibuan(nominal);
    return nominal;
  }

  function hitungTotal() {
    var jumlah = 0;
    barisItem().forEach(function (tr) { jumlah += hitungBaris(tr); });
    var elSub = document.getElementById('subtotal-item');
    if (elSub) elSub.textContent = keRibuan(jumlah);

    // Tambahan biaya khusus formulir CAPEX
    var tambahan = 0;
    ['pengiriman', 'instalasi', 'biaya_lain'].forEach(function (nama) {
      var el = document.querySelector('[name="' + nama + '"]');
      if (el) tambahan += angkaDari(el.value);
    });
    var elTambahan = document.getElementById('tambahan-item');
    if (elTambahan) elTambahan.textContent = keRibuan(tambahan);
    var total = jumlah + tambahan;

    // Formulir Refund Dana tidak punya tabel rincian: nilainya satu kolom.
    // Rumusnya harus sama dengan hitungTotal() di server.
    if (!document.getElementById('tabel-item')) {
      var elTunggal = document.querySelector('[name="nominal"]');
      if (elTunggal) total = angkaDari(elTunggal.value);
    }

    var elTotal = document.getElementById('total-pengajuan');
    if (elTotal) elTotal.textContent = rupiah(total);

    hitungAnalisa(total);
    perbaruiAmbang(total);
  }

  // Analisa retail Form CAPEX
  function hitungAnalisa(total) {
    var elSales = document.querySelector('[name="sales_tambahan"]');
    var elMargin = document.querySelector('[name="margin_persen"]');
    if (!elSales || !elMargin) return;
    var sales = angkaDari(elSales.value);
    var margin = parseFloat(String(elMargin.value).replace(',', '.')) || 0;
    var profit = Math.round(sales * (margin / 100));
    var payback = profit > 0 ? (total / profit) : null;
    var roi = total > 0 ? ((profit * 12) / total) * 100 : null;
    taruh('hasil-profit', profit ? rupiah(profit) : '-');
    taruh('hasil-payback', payback ? payback.toFixed(1) + ' bulan' : '-');
    taruh('hasil-roi', roi ? roi.toFixed(1) + ' % / tahun' : '-');
    var kotakProfit = document.getElementById('hasil-profit-kotak');
    if (kotakProfit) kotakProfit.value = profit ? rupiah(profit) : '-';
    var kotakPayback = document.getElementById('hasil-payback-kotak');
    if (kotakPayback) {
      kotakPayback.value = (payback && roi)
        ? payback.toFixed(1) + ' bulan  ·  ROI ' + roi.toFixed(1) + '%/tahun'
        : '-';
    }
  }

  function taruh(id, teks) {
    var el = document.getElementById(id);
    if (el) el.textContent = teks;
  }

  // Tampilkan rantai approval yang akan berlaku untuk nominal saat ini.
  function perbaruiAmbang(total) {
    var wadah = document.getElementById('rantai-perkiraan');
    if (!wadah) return;
    var simpul = Array.prototype.slice.call(wadah.querySelectorAll('[data-min]'));
    simpul.forEach(function (el) {
      var min = angkaDari(el.getAttribute('data-min'));
      var perlu = !min || total >= min;
      el.style.opacity = perlu ? '1' : '.35';
      el.style.textDecoration = perlu ? 'none' : 'line-through';
    });
  }

  function tambahBaris() {
    var tbody = document.querySelector('#tabel-item tbody');
    var contoh = document.getElementById('contoh-baris');
    if (!tbody || !contoh) return;
    var tr = document.createElement('tr');
    tr.innerHTML = contoh.innerHTML;
    tbody.appendChild(tr);
    pasangKolomUang(tr);
    nomoriBaris();
    hitungTotal();
    var isian = tr.querySelector('input');
    if (isian) isian.focus();
  }

  function nomoriBaris() {
    barisItem().forEach(function (tr, i) {
      var no = tr.querySelector('.no-baris');
      if (no) no.textContent = (i + 1) + '.';
    });
  }

  // -------------------------------------------------------------- umur ekonomis aset (CAPEX)
  // Murni tampilan, dihitung dari kategori aset (lib/konstanta.js umurAset) --
  // dikirim lewat data-umur-aset pada <select>, bukan <script> sebaris (CSP).
  // Field-nya sendiri disabled sehingga tidak pernah ikut terkirim di formulir.
  function pasangUmurAset() {
    var sel = document.getElementById('kategori-aset');
    var info = document.getElementById('umur-aset-info');
    if (!sel || !info) return;
    var peta = {};
    try { peta = JSON.parse(sel.getAttribute('data-umur-aset') || '{}'); } catch (e) { peta = {}; }
    sel.addEventListener('change', function () {
      info.value = (peta[sel.value] || '-') + ' tahun';
    });
  }

  // -------------------------------------------------------------- lain-lain
  // Pendengar tunggal untuk SEMUA isian: qty, margin, dan kolom uang sama-sama
  // memicu hitung ulang. Tanpa ini, mengubah Qty atau Margin (yang bukan kolom
  // uang) tidak memperbarui subtotal, total, maupun analisa retail.
  function pasangHitungUlang() {
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) hitungTotal();
    });
  }

  function pasangKlik() {
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-aksi]');
      if (!t) return;
      var aksi = t.getAttribute('data-aksi');

      if (aksi === 'tambah-baris') { e.preventDefault(); tambahBaris(); }

      if (aksi === 'hapus-baris') {
        e.preventDefault();
        var tr = t.closest('tr');
        if (tr && barisItem().length > 1) tr.remove();
        else if (tr) tr.querySelectorAll('input').forEach(function (i) { i.value = ''; });
        nomoriBaris(); hitungTotal();
      }

      if (aksi === 'konfirmasi') {
        var pesan = t.getAttribute('data-pesan') || 'Lanjutkan?';
        if (!window.confirm(pesan)) e.preventDefault();
      }

      if (aksi === 'terapkan-baca') { e.preventDefault(); terapkanHasilBaca(); }

      if (aksi === 'abaikan-baca') {
        e.preventDefault();
        hasilBaca = null;
        var panelBaca = document.getElementById('hasil-baca');
        if (panelBaca) panelBaca.hidden = true;
      }

      if (aksi === 'cetak') { e.preventDefault(); window.print(); }
    });

    // Kotak alasan wajib untuk tolak / minta revisi
    document.querySelectorAll('form[data-perlu-alasan]').forEach(function (f) {
      f.addEventListener('submit', function (e) {
        var aksi = (f.querySelector('[name="aksi"]:checked') || f.querySelector('[name="aksi"]') || {}).value;
        var alasan = f.querySelector('[name="komentar"]');
        if ((aksi === 'tolak' || aksi === 'revisi') && alasan && !alasan.value.trim()) {
          e.preventDefault();
          alasan.focus();
          alert('Alasan wajib diisi saat menolak atau meminta revisi.');
        }
      });
    });

    // Pilihan aksi approval: tampilkan kotak alasan bila perlu
    document.querySelectorAll('[name="aksi"]').forEach(function (el) {
      el.addEventListener('change', function () {
        var wadah = document.getElementById('wadah-alasan');
        if (!wadah) return;
        var perlu = el.value !== 'setuju';
        wadah.style.display = perlu ? '' : '';
        var label = document.getElementById('label-alasan');
        if (label) label.textContent = perlu ? 'Alasan (wajib)' : 'Catatan (opsional)';
      });
    });

    // Ganti wilayah/aturan -> muat ulang formulir dengan pilihan unit yang sesuai
    var pilihAturan = document.getElementById('pilih-aturan');
    if (pilihAturan) {
      pilihAturan.addEventListener('change', function () {
        var dasar = pilihAturan.getAttribute('data-url');
        window.location = dasar + '?aturan_id=' + encodeURIComponent(pilihAturan.value);
      });
    }
  }

  /* ------------------------------------------------------------------ PWA */
  // Service worker membuat aplikasi bisa dipasang di layar utama HP dan menerima
  // notifikasi approval. Kegagalan di sini tidak boleh mengganggu pemakaian biasa.
  function pasangServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (e) {
        console.warn('Service worker gagal dipasang:', e && e.message);
      });
    });
  }

  function tokenCsrf() {
    var el = document.querySelector('input[name="_csrf"]');
    return el ? el.value : '';
  }

  function kirimJson(alamat, isi) {
    return fetch(alamat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': tokenCsrf() },
      body: JSON.stringify(isi || {}),
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  // Kunci VAPID datang sebagai teks base64url; API peramban memintanya sebagai byte.
  function keByte(base64url) {
    var isi = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    var mentah = window.atob(isi);
    var byte = new Uint8Array(mentah.length);
    for (var i = 0; i < mentah.length; i++) byte[i] = mentah.charCodeAt(i);
    return byte;
  }

  function terpasangSebagaiAplikasi() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function iOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function pasangNotifikasiHp() {
    var tombol = document.getElementById('tombol-notifikasi');
    var status = document.getElementById('status-notifikasi');
    var tombolUji = document.getElementById('tombol-uji-notifikasi');

    // Petunjuk pemasangan khusus iPhone (Safari tidak punya tombol "Install").
    var petunjukIos = document.getElementById('petunjuk-ios');
    if (petunjukIos && iOS() && !terpasangSebagaiAplikasi()) petunjukIos.style.display = '';
    if (!tombol || !status) return;

    var didukung = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    function tulis(pesan, kelas) {
      status.textContent = pesan;
      status.className = 'lencana ' + (kelas || 'abu');
    }

    function segarkan() {
      if (!didukung) {
        tombol.disabled = true;
        if (iOS() && !terpasangSebagaiAplikasi()) tulis('Pasang dulu ke layar utama', 'oranye');
        else tulis('Peramban ini belum mendukung', 'abu');
        return;
      }
      if (Notification.permission === 'denied') {
        tombol.disabled = true;
        tulis('Izin ditolak di pengaturan peramban', 'merah');
        return;
      }
      navigator.serviceWorker.ready.then(function (reg) {
        return reg.pushManager.getSubscription();
      }).then(function (langganan) {
        if (langganan) {
          tulis('Aktif di perangkat ini', 'hijau');
          tombol.textContent = 'Matikan notifikasi di HP ini';
          tombol.dataset.mode = 'mati';
          if (tombolUji) tombolUji.style.display = '';
        } else {
          tulis('Belum aktif di perangkat ini', 'kuning');
          tombol.textContent = 'Aktifkan notifikasi di HP ini';
          tombol.dataset.mode = 'hidup';
          if (tombolUji) tombolUji.style.display = 'none';
        }
        tombol.disabled = false;
      }).catch(function () { tulis('Tidak bisa diperiksa', 'abu'); });
    }

    tombol.addEventListener('click', function () {
      tombol.disabled = true;
      if (tombol.dataset.mode === 'mati') {
        navigator.serviceWorker.ready
          .then(function (reg) { return reg.pushManager.getSubscription(); })
          .then(function (l) {
            if (!l) return null;
            var alamat = l.endpoint;
            return l.unsubscribe().then(function () {
              return kirimJson('/api/notifikasi/langganan/hapus', { endpoint: alamat });
            });
          })
          .then(segarkan)
          .catch(function () { tulis('Gagal mematikan', 'merah'); tombol.disabled = false; });
        return;
      }

      // Izin HARUS diminta dari ketukan pengguna — kalau tidak, peramban menolaknya.
      Notification.requestPermission().then(function (izin) {
        if (izin !== 'granted') { segarkan(); return; }
        return fetch('/api/notifikasi/kunci').then(function (r) { return r.json(); }).then(function (j) {
          if (!j.aktif || !j.kunci) {
            tulis('Server belum menyiapkan kunci notifikasi', 'merah');
            tombol.disabled = false;
            return;
          }
          return navigator.serviceWorker.ready.then(function (reg) {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keByte(j.kunci) });
          }).then(function (langganan) {
            return kirimJson('/api/notifikasi/langganan', { langganan: langganan.toJSON() });
          }).then(function (jawab) {
            if (jawab && !jawab.ok) tulis(jawab.pesan || 'Gagal mendaftar', 'merah');
            segarkan();
          });
        });
      }).catch(function () { tulis('Gagal meminta izin', 'merah'); tombol.disabled = false; });
    });

    if (tombolUji) {
      tombolUji.addEventListener('click', function () {
        tombolUji.disabled = true;
        kirimJson('/api/notifikasi/uji', {}).then(function (j) {
          tombolUji.disabled = false;
          if (!j.ok) alert(j.pesan || 'Notifikasi uji tidak terkirim. Coba aktifkan ulang.');
        });
      });
    }

    segarkan();
  }

  /* ------------------------------------------------------------------ pilih kategori */
  // Halaman "Pengajuan Baru": mengetuk kelompok di kiri menampilkan kategorinya
  // di kanan. Di layar sempit menu kiri disembunyikan lewat CSS dan SEMUA kelompok
  // tampil berurutan — karena itu di sini kelas 'sembunyi' yang dipakai, bukan
  // gaya sebaris: media query masih bisa menimpanya.
  function pasangPilihKategori() {
    var tombol = Array.prototype.slice.call(document.querySelectorAll('.grup-tombol'));
    if (!tombol.length) return;
    var isi = Array.prototype.slice.call(document.querySelectorAll('.isi-grup'));
    tombol.forEach(function (t) {
      t.addEventListener('click', function () {
        tombol.forEach(function (x) {
          x.classList.remove('aktif');
          x.setAttribute('aria-selected', 'false');
        });
        t.classList.add('aktif');
        t.setAttribute('aria-selected', 'true');
        isi.forEach(function (g) {
          g.classList.toggle('sembunyi', g.getAttribute('data-grup') !== t.getAttribute('data-grup'));
        });
      });
    });
  }

  /* ------------------------------------------------------------------ petunjuk isian */
  // Bilah petunjuk menempel di tepi bawah layar: muncul mengikuti isian yang
  // sedang disentuh, lalu hilang sendiri. Ditunda sesaat saat kehilangan fokus
  // supaya tidak berkedip ketika pengguna berpindah antar isian.
  function pasangBantuMedan() {
    var bar = document.getElementById('bar-bantu');
    var wadah = document.getElementById('wadah-form');
    if (!bar || !wadah) return;
    var namaEl = bar.querySelector('.nama-medan');
    var isiEl = bar.querySelector('.isi-bantu');
    var timer = null;

    function tampilkan(el) {
      if (!el || !el.getAttribute) return;
      var teks = el.getAttribute('data-bantu');
      if (!teks) return;
      window.clearTimeout(timer);
      var nama = el.getAttribute('data-medan');
      namaEl.textContent = nama ? nama + ' — ' : '';
      isiEl.textContent = teks;
      bar.classList.remove('diam');
    }

    function sembunyikan() {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        if (!wadah.contains(document.activeElement)) bar.classList.add('diam');
      }, 180);
    }

    wadah.addEventListener('focusin', function (e) { tampilkan(e.target); });
    wadah.addEventListener('focusout', sembunyikan);
    wadah.addEventListener('mouseover', function (e) { tampilkan(e.target); });
    wadah.addEventListener('mouseleave', sembunyikan);
  }

  // ------------------------------------------------- daftar berkas yang dipilih
  // Kotak berkas bawaan peramban hanya menulis "3 files"; nama dan ukurannya
  // ditampilkan sendiri supaya orang tahu penawaran mana yang ikut terkirim —
  // dan tahu SEBELUM mengirim kalau ada berkas yang kelewat besar.
  // ------------------------------------------------- kompresi foto penawaran
  // Foto penawaran dari HP biasanya 3–8 MB, padahal yang dibutuhkan cuma
  // tulisannya terbaca. Dikecilkan di peramban SEBELUM dikirim: hemat kuota
  // orang cabang, hemat penyimpanan, dan unggahannya jauh lebih cepat.
  //
  // SYARATNYA HARUS TETAP JELAS. Karena itu:
  //   - sisi terpanjang 2000 piksel. Untuk foto kertas A4 itu sekitar 7 piksel
  //     per milimeter — tulisan 10pt jadi ~23 piksel, masih terbaca lega.
  //   - mutu 0,85, bukan 0,6. Selisih ukurannya kecil, selisih ketajaman
  //     tulisannya besar.
  //   - foto yang sudah kecil (< 600 KB) TIDAK disentuh sama sekali.
  //   - kalau hasilnya ternyata tidak lebih kecil, yang asli yang dipakai.
  //   - PDF, Excel, Word TIDAK PERNAH disentuh — isinya bukan piksel.
  //   - arah foto dari HP diikutkan (imageOrientation), supaya tidak jadi miring
  //     dan malah lebih susah dibaca daripada sebelum dikompres.
  var kompresBerjalan = false;

  function bisaKompres() {
    return typeof window.createImageBitmap === 'function'
      && typeof document.createElement('canvas').toBlob === 'function'
      && typeof DataTransfer === 'function';
  }

  function kompresGambar(file, maksPx, mutu) {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (gbr) {
      var skala = Math.min(1, maksPx / Math.max(gbr.width, gbr.height));
      var lebar = Math.round(gbr.width * skala);
      var tinggi = Math.round(gbr.height * skala);

      var kanvas = document.createElement('canvas');
      kanvas.width = lebar;
      kanvas.height = tinggi;
      var ktx = kanvas.getContext('2d');
      ktx.imageSmoothingEnabled = true;
      ktx.imageSmoothingQuality = 'high';
      ktx.drawImage(gbr, 0, 0, lebar, tinggi);
      if (gbr.close) gbr.close();

      return new Promise(function (selesai) {
        kanvas.toBlob(function (blob) {
          // Tidak lebih kecil? Berarti tidak ada gunanya — pakai yang asli.
          if (!blob || blob.size >= file.size) return selesai(null);
          var namaBaru = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          selesai(new File([blob], namaBaru, { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', mutu);
      });
    }).catch(function () { return null; });     // gagal baca gambar = pakai aslinya
  }

  function pasangDaftarBerkas() {
    var kotak = document.getElementById('berkas-awal');
    var daftar = document.getElementById('daftar-pilihan');
    if (!kotak || !daftar) return;
    var maksMB = Number(kotak.getAttribute('data-maks-mb') || 10);
    var maksPx = Number(kotak.getAttribute('data-maks-piksel') || 2000);
    var mutu = Number(kotak.getAttribute('data-mutu-gambar') || 0.85);
    var batasSentuh = 600 * 1024;

    function ukuranTeks(byte) {
      var mb = byte / (1024 * 1024);
      return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(byte / 1024)) + ' KB';
    }

    function gambar(f) { return /^image\//.test(f.type) && !/svg/.test(f.type); }

    function tampilkan(rincian) {
      daftar.innerHTML = '';
      rincian.forEach(function (r) {
        var li = document.createElement('li');
        if (r.byte / (1024 * 1024) > maksMB) li.className = 'terlalu-besar';
        var nama = document.createElement('span');
        nama.textContent = r.nama;
        var ukuran = document.createElement('span');
        ukuran.className = 'ukuran';
        if (r.byte / (1024 * 1024) > maksMB) ukuran.textContent = ukuranTeks(r.byte) + ' — terlalu besar';
        else if (r.asli && r.asli > r.byte) ukuran.textContent = ukuranTeks(r.asli) + ' → ' + ukuranTeks(r.byte);
        else ukuran.textContent = ukuranTeks(r.byte);
        li.appendChild(nama);
        li.appendChild(ukuran);
        daftar.appendChild(li);
      });
    }

    kotak.addEventListener('change', function () {
      var semula = Array.prototype.slice.call(kotak.files || []);
      if (!semula.length) { daftar.innerHTML = ''; return; }

      // Tampilkan apa adanya dulu supaya layar tidak terasa diam.
      tampilkan(semula.map(function (f) { return { nama: f.name, byte: f.size }; }));

      var perluKompres = bisaKompres()
        && semula.some(function (f) { return gambar(f) && f.size > batasSentuh; });
      if (!perluKompres) return;

      kompresBerjalan = true;
      daftar.classList.add('sedang-kompres');

      Promise.all(semula.map(function (f) {
        if (!gambar(f) || f.size <= batasSentuh) return Promise.resolve({ file: f, asli: null });
        return kompresGambar(f, maksPx, mutu).then(function (kecil) {
          return kecil ? { file: kecil, asli: f.size } : { file: f, asli: null };
        });
      })).then(function (hasil) {
        var dt = new DataTransfer();
        hasil.forEach(function (h) { dt.items.add(h.file); });
        kotak.files = dt.files;
        tampilkan(hasil.map(function (h) {
          return { nama: h.file.name, byte: h.file.size, asli: h.asli };
        }));
      }).catch(function () { /* biarkan berkas aslinya */ })
        .then(function () {
          kompresBerjalan = false;
          daftar.classList.remove('sedang-kompres');
        });
    });

    // Kiriman ditahan selama kompresi belum selesai. Tanpa ini, orang yang cepat
    // menekan Ajukan akan mengirim berkas aslinya yang berukuran penuh —
    // kadang berhasil, kadang ditolak karena kelewat besar. Tidak boleh
    // bergantung pada kecepatan tangan.
    var form = kotak.closest('form');
    if (form) {
      form.addEventListener('submit', function (e) {
        if (!kompresBerjalan) return;
        e.preventDefault();
        window.alert('Fotonya sedang dikecilkan dulu. Tunggu sebentar lalu tekan lagi.');
      });
    }
  }

  // ------------------------------------------------- baca penawaran otomatis
  // Hasil bacaan TIDAK pernah langsung masuk formulir. Ditampilkan dulu apa
  // adanya untuk diperiksa, baru dipasang kalau pemakainya menekan "Terapkan".
  var hasilBaca = null;

  function tampilkanHasilBaca(j) {
    hasilBaca = j.hasil;
    var panel = document.getElementById('hasil-baca');
    var lencana = document.getElementById('lencana-keyakinan');
    var wadahPeringatan = document.getElementById('peringatan-baca');
    var ringkas = document.getElementById('ringkas-baca');
    var tbody = document.querySelector('#tabel-baca tbody');
    if (!panel) return;

    lencana.textContent = 'Keyakinan ' + j.hasil.keyakinan;
    lencana.className = 'lencana ' + (j.hasil.keyakinan === 'tinggi' ? 'hijau'
      : j.hasil.keyakinan === 'rendah' ? 'merah' : 'kuning');

    wadahPeringatan.innerHTML = '';
    (j.peringatan || []).forEach(function (t) {
      var d = document.createElement('div');
      d.className = 'pesan galat rapat';
      d.textContent = t;
      wadahPeringatan.appendChild(d);
    });

    var bagian = [];
    if (j.hasil.vendor) bagian.push('Vendor: ' + j.hasil.vendor);
    if (j.hasil.nama_proyek) bagian.push('Perihal: ' + j.hasil.nama_proyek);
    if (j.hasil.pengiriman) bagian.push('Pengiriman: ' + rupiah(j.hasil.pengiriman));
    if (j.hasil.instalasi) bagian.push('Instalasi: ' + rupiah(j.hasil.instalasi));
    if (j.hasil.biaya_lain) bagian.push('Biaya lain: ' + rupiah(j.hasil.biaya_lain));
    if (j.hasil.catatan) bagian.push('Catatan: ' + j.hasil.catatan);
    ringkas.innerHTML = '';
    bagian.forEach(function (t) {
      var s = document.createElement('span');
      s.className = 'butir';
      s.textContent = t;
      ringkas.appendChild(s);
    });

    tbody.innerHTML = '';
    j.hasil.items.forEach(function (it) {
      var tr = document.createElement('tr');
      [it.nama, it.qty, it.satuan, keRibuan(it.harga)].forEach(function (nilai, i) {
        var td = document.createElement('td');
        if (i === 3) td.className = 'angka';
        td.textContent = nilai;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    panel.hidden = false;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function terapkanHasilBaca() {
    if (!hasilBaca) return;
    var tbody = document.querySelector('#tabel-item tbody');
    if (tbody && hasilBaca.items.length) {
      tbody.innerHTML = '';
      hasilBaca.items.forEach(function (it) {
        tambahBaris();
        var tr = tbody.lastElementChild;
        var isi = function (nama, nilai) {
          var el = tr.querySelector('[name="' + nama + '"]');
          if (el) el.value = nilai;
        };
        isi('item_nama[]', it.nama);
        isi('item_qty[]', it.qty);
        isi('item_satuan[]', it.satuan);
        isi('item_harga[]', keRibuan(it.harga));
        isi('item_ket[]', it.keterangan);
      });
    }
    [['pengiriman', hasilBaca.pengiriman], ['instalasi', hasilBaca.instalasi], ['biaya_lain', hasilBaca.biaya_lain]]
      .forEach(function (pasangan) {
        var el = document.querySelector('[name="' + pasangan[0] + '"]');
        if (el && pasangan[1]) el.value = keRibuan(pasangan[1]);
      });

    // Perihal & nama proyek hanya diisi kalau memang masih kosong — kalimat yang
    // sudah diketik orang tidak boleh ditimpa mesin.
    [['judul', hasilBaca.nama_proyek], ['nama_proyek', hasilBaca.nama_proyek]].forEach(function (pasangan) {
      var el = document.querySelector('[name="' + pasangan[0] + '"]');
      if (el && !el.value.trim() && pasangan[1]) el.value = pasangan[1];
    });

    hitungTotal();
    var panel = document.getElementById('hasil-baca');
    if (panel) panel.hidden = true;
  }

  function pasangBacaPenawaran() {
    var tombol = document.getElementById('tombol-baca');
    var kotak = document.getElementById('berkas-awal');
    var baris = document.getElementById('baris-baca');
    if (!tombol || !kotak || !baris) return;

    // Tombolnya selalu terlihat supaya orang tahu fitur ini ada. Yang berubah
    // hanya bisa-tidaknya ditekan: mati permanen kalau fiturnya belum dinyalakan,
    // dan mati sementara selama belum ada berkas yang dipilih.
    var aktif = tombol.getAttribute('data-aktif') === '1';
    var adaBerkas = function () { return !!(kotak.files && kotak.files.length); };
    var perbaruiTombol = function () { tombol.disabled = !aktif || !adaBerkas(); };
    perbaruiTombol();

    kotak.addEventListener('change', function () {
      perbaruiTombol();
      var panel = document.getElementById('hasil-baca');
      if (panel) panel.hidden = true;
    });

    tombol.addEventListener('click', function () {
      if (!aktif || !adaBerkas()) return;
      var fd = new FormData();
      var medanCsrf = document.querySelector('[name=_csrf]');
      fd.append('_csrf', medanCsrf ? medanCsrf.value : '');
      for (var i = 0; i < kotak.files.length && i < 5; i++) fd.append('berkas', kotak.files[i]);

      var teksAsli = tombol.textContent;
      tombol.disabled = true;
      tombol.textContent = 'Membaca penawaran…';

      fetch(tombol.getAttribute('data-url'), { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (hasil) {
          if (!hasil.ok || !hasil.j.ok) throw new Error(hasil.j.pesan || 'Penawaran gagal dibaca.');
          tampilkanHasilBaca(hasil.j);
        })
        .catch(function (e) {
          var wadah = document.getElementById('peringatan-baca');
          var panel = document.getElementById('hasil-baca');
          if (wadah && panel) {
            wadah.innerHTML = '';
            var d = document.createElement('div');
            d.className = 'pesan galat rapat';
            d.textContent = e.message;
            wadah.appendChild(d);
            document.querySelector('#tabel-baca tbody').innerHTML = '';
            document.getElementById('ringkas-baca').innerHTML = '';
            document.getElementById('lencana-keyakinan').textContent = '';
            panel.hidden = false;
          }
        })
        .then(function () { tombol.textContent = teksAsli; perbaruiTombol(); });
    });
  }

  // ------------------------------------------------- tanda isian wajib
  // Daftar isian wajib datang dari server (atribut data-wajib), sumbernya sama
  // persis dengan yang dipakai memeriksa kiriman. Kalau daftarnya ditulis dua
  // kali — sekali di layar, sekali di server — cepat atau lambat keduanya beda,
  // dan orang akan melihat formulir yang tampak lengkap tapi ditolak.
  function pasangTandaWajib() {
    var form = document.querySelector('form[data-wajib]');
    if (!form) return;
    var daftar = (form.getAttribute('data-wajib') || '').split(',').filter(Boolean);

    daftar.forEach(function (nama) {
      var el = form.querySelectorAll('[name="' + nama + '"], [name="' + nama + '[]"]');
      if (!el.length) return;
      var pertama = el[0];
      var pilihan = pertama.type === 'checkbox' || pertama.type === 'radio';
      // Kotak centang TIDAK diberi required: peramban akan menuntut SEMUA
      // kotaknya dicentang, padahal yang diminta cukup satu. Sisanya diperiksa
      // server saat dokumen diajukan.
      if (!pilihan) pertama.required = true;

      var medan = pertama.closest('.medan') || pertama.closest('.bagian');
      var label = medan && medan.querySelector('label.f');
      if (label && !label.querySelector('.wajib')) {
        var bintang = document.createElement('span');
        bintang.className = 'wajib';
        bintang.textContent = '*';
        label.appendChild(document.createTextNode(' '));
        label.appendChild(bintang);
      }
    });

    // Lampiran wajib: dijaga di sini supaya orang tahu SEBELUM menekan Ajukan,
    // bukan setelah halaman terkirim dan kembali dengan pesan galat.
    if (form.getAttribute('data-lampiran-wajib') === '1') {
      form.addEventListener('submit', function (e) {
        var tombol = e.submitter;
        if (!tombol || tombol.value !== 'ajukan') return;
        var kotak = document.getElementById('berkas-awal');
        var sudahAda = document.querySelectorAll('.lampiran-ada .cip-berkas').length;
        if (sudahAda || (kotak && kotak.files && kotak.files.length)) return;
        e.preventDefault();
        window.alert('Lampiran penawaran wajib diisi sebelum dokumen bisa diajukan.\n\n'
          + 'Tanpa lampiran, penyetuju tidak punya apa pun untuk mencocokkan angkanya. '
          + 'Simpan sebagai draft dulu kalau berkasnya belum ada.');
        if (kotak) kotak.focus();
      });
    }
  }

  // Kotak alasan melewati tahap berikutnya baru muncul kalau pilihannya dicentang,
  // dan begitu muncul isinya WAJIB — melewati satu lapis pemeriksaan tanpa alasan
  // tertulis membuat dokumennya tidak bisa dipertanggungjawabkan setahun lagi.
  function pasangPilihanLewat() {
    var kotak = document.getElementById('pilih-lewat');
    var wadah = document.getElementById('wadah-alasan-lewat');
    if (!kotak || !wadah) return;
    var isian = wadah.querySelector('[name=alasan_lewat]');
    kotak.addEventListener('change', function () {
      wadah.hidden = !kotak.checked;
      if (isian) isian.required = kotak.checked;
      if (kotak.checked && isian) isian.focus();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    pasangKolomUang(document);
    pasangHitungUlang();
    pasangKlik();
    nomoriBaris();
    hitungTotal();
    pasangServiceWorker();
    pasangNotifikasiHp();
    pasangPilihKategori();
    pasangBantuMedan();
    pasangDaftarBerkas();
    pasangBacaPenawaran();
    pasangTandaWajib();
    pasangPilihanLewat();
    pasangUmurAset();
  });
})();
