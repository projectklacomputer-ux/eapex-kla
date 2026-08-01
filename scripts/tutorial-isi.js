// ============================================================================
//  Isi tutorial EAPEX - dipisah per pembaca
// ============================================================================
//  Dua jalur, karena kedua kelompok ini benar-benar berbeda: kategori yang
//  boleh diajukan berbeda, dan rantai persetujuannya berbeda. Memberi satu
//  dokumen berisi keduanya membuat orang membaca aturan yang bukan miliknya
//  lalu mengira alurnya macet.
//
//    cabang      Store Manager di 15 cabang. Rantai: Area Manager ->
//                Regional Manager -> Accounting -> CEO.
//    backoffice  Staf di Kantor Pusat (HC, Marketing, Accounting). Rantai:
//                atasan langsung -> Accounting -> CEO.
//
//  Angka ambang di sini DIBACA DARI BASIS DATA saat PDF dibuat, bukan ditulis
//  tangan - kalau ambangnya diubah lewat menu Admin, tutorialnya ikut benar
//  pada pembuatan berikutnya.
// ============================================================================

const rupiah = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

// --------------------------------------------------------------------- umum
const LANGKAH_MASUK = (alamat) => [
  {
    judul: 'Buka alamat aplikasinya',
    isi: `Buka <b>${alamat}</b> lewat peramban (Chrome di HP maupun komputer).
          Aplikasi ini tidak perlu dipasang dari Play Store atau App Store.`,
    gambar: 'login',
    ketGambar: 'Halaman masuk EAPEX',
  },
  {
    judul: 'Masuk dengan akun Anda',
    isi: `Isi <b>email kantor</b> dan <b>sandi sementara</b> yang dibagikan
          Administrator. Sandi sementara hanya berlaku untuk masuk pertama kali.`,
    catatan: 'Sandi dibagikan per orang. Jangan meneruskannya ke siapa pun, termasuk rekan sedivisi.',
  },
  {
    judul: 'Ganti sandi',
    isi: `Sistem langsung meminta Anda mengganti sandi. Pilih sandi yang hanya
          Anda yang tahu. Setelah ini, sandi sementara tadi tidak berlaku lagi.`,
    gambar: 'ganti-sandi',
    ketGambar: 'Layar ganti sandi pada masuk pertama',
  },
  {
    judul: 'Pasang di layar utama HP',
    isi: `Supaya bisa menerima pemberitahuan saat ada dokumen yang menunggu Anda:
          <br><br>
          <b>Android (Chrome):</b> menu titik tiga di kanan atas &rarr; <b>Install app</b>
          atau <b>Tambahkan ke layar utama</b>.
          <br>
          <b>iPhone / iPad (Safari):</b> tombol <b>Bagikan</b> &rarr; <b>Add to Home Screen</b>.`,
    // Sengaja tanpa gambar: yang ditunjukkan adalah menu PERAMBAN, bukan layar
    // aplikasi ini. Menunya berbeda antar merek HP dan berubah tiap pembaruan,
    // jadi gambar di sini justru menyesatkan lebih cepat daripada tulisannya.
    catatan: 'Di iPhone langkah ini WAJIB. Apple tidak mengizinkan notifikasi web sampai aplikasinya dipasang ke layar utama. Ini batasan Safari, bukan kekurangan aplikasi.',
  },
  {
    judul: 'Izinkan notifikasi',
    isi: `Saat pertama membuka aplikasi yang sudah terpasang, akan muncul
          permintaan izin notifikasi. Pilih <b>Izinkan</b>.`,
    catatan: 'Kalau ditolak, dokumen yang menunggu Anda tetap masuk ke Kotak Approval, hanya tidak ada pemberitahuan yang muncul di HP.',
  },
];

const LANGKAH_KELUAR = [
  {
    judul: 'Keluar sendiri setelah 60 menit diam',
    isi: `Kalau aplikasi dibiarkan tanpa aktivitas selama 60 menit, sesi berakhir
          dan Anda diminta masuk lagi. Yang dihitung adalah <b>diamnya</b>, bukan
          lama Anda bekerja - selama masih mengetik atau berpindah halaman, sesi
          tidak akan putus di tengah pengisian.`,
    catatan: 'Kalau muncul "Token keamanan tidak cocok", itu tandanya halaman terbuka terlalu lama. Muat ulang halaman (Ctrl+Shift+R), lalu isi lagi.',
  },
];

// ------------------------------------------------------------------ approval
const LANGKAH_MENYETUJUI = [
  {
    judul: 'Buka Kotak Approval',
    isi: `Menu <b>Kotak Approval</b> di sebelah kiri memuat dokumen yang menunggu
          keputusan Anda - dan hanya itu. Dokumen yang sedang menunggu orang lain
          tidak muncul di sini.`,
    gambar: 'approval',
    ketGambar: 'Kotak Approval',
  },
  {
    judul: 'Periksa isinya sebelum memutuskan',
    isi: `Buka dokumennya. Yang perlu dilihat: <b>total nominal</b>, <b>justifikasi</b>,
          <b>lampiran penawaran</b>, dan <b>riwayat langkah</b> di bagian bawah -
          siapa saja yang sudah menyetujui dan catatan apa yang mereka tinggalkan.`,
    gambar: 'detail',
    ketGambar: 'Rincian pengajuan berikut riwayat persetujuannya',
  },
  {
    judul: 'Pilih keputusan',
    isi: `Tersedia tiga tombol:
          <br><br>
          <b>Setujui</b> - dokumen lanjut ke tahap berikutnya, dan penyetuju
          berikutnya langsung diberi tahu.
          <br>
          <b>Minta revisi</b> - dokumen kembali ke pemohon untuk diperbaiki,
          lalu berjalan lagi dari awal rantai.
          <br>
          <b>Tolak</b> - dokumen berhenti. Ini keputusan akhir.`,
    catatan: 'Alasan wajib diisi saat menolak atau meminta revisi. Pemohon hanya membaca alasan itu - kalau kosong, dia akan mengajukan hal yang sama lagi.',
  },
];

// ---------------------------------------------------------------------- cuti
const LANGKAH_CUTI = [
  {
    judul: 'Beri tahu sistem saat Anda tidak bisa menyetujui',
    isi: `Menu <b>Cuti Saya</b>. Isi tanggal mulai dan selesai, lalu pilih salah
          satu dari tiga kemungkinan:
          <br><br>
          <b>Tetap saya yang menyetujui</b> - dokumen menunggu Anda kembali.
          <br>
          <b>Dialihkan ke pengganti</b> - Anda menunjuk orang yang menggantikan.
          <br>
          <b>Menyatakan tidak bisa menyetujui</b> - penyetuju sebelumnya yang
          memastikan dan meneruskannya.`,
    gambar: 'cuti',
    ketGambar: 'Pengaturan cuti dan pengganti',
  },
  {
    judul: 'Yang tidak bisa dilewati',
    isi: `Tahap <b>Accounting</b> tidak pernah bisa dilewati, apa pun alasannya.
          Verifikasi anggaran dan kelengkapan dokumen tidak punya pengganti.`,
    catatan: 'Kalau sebuah dokumen berhenti karena seluruh calon penyetuju di satu tahap sedang tidak tersedia, Administrator langsung diberi tahu - dokumennya tidak akan diam tanpa ada yang tahu.',
  },
];

// ============================================================================
//  Jalur CABANG (non back office)
// ============================================================================
const CABANG = {
  kode: 'cabang',
  judul: 'Panduan EAPEX untuk Cabang',
  subjudul: 'Store Manager & Area Manager',
  ringkas: `Panduan ini untuk Anda yang bertugas di cabang. Rantai persetujuannya
            melewati Area Manager dan Regional Manager sebelum sampai ke Accounting
            dan CEO.`,
  wilayah: 'store',
  bab: [
    { judul: 'Masuk pertama kali', langkah: null /* diisi generator */ },
    {
      judul: 'Mengenal layarnya',
      langkah: [
        {
          judul: 'Dasbor',
          isi: `Halaman pertama setelah masuk. Memuat ringkasan pengajuan Anda:
                yang masih berjalan, yang disetujui, dan yang perlu diperbaiki.`,
          gambar: 'dasbor',
          ketGambar: 'Dasbor',
        },
        {
          judul: 'Menu sebelah kiri',
          isi: `<b>Dasbor</b> - ringkasan.<br>
                <b>Pengajuan Baru</b> - membuat dokumen.<br>
                <b>Daftar Pengajuan</b> - semua dokumen Anda, bisa diunduh ke Excel.<br>
                <b>Kotak Approval</b> - hanya muncul bila Anda punya wewenang menyetujui.<br>
                <b>Notifikasi</b> - riwayat pemberitahuan.<br>
                <b>Cuti Saya</b> - mengatur ketidakhadiran.`,
        },
      ],
    },
    { judul: 'Membuat pengajuan', langkah: null },
    { judul: 'Menyetujui pengajuan', langkah: LANGKAH_MENYETUJUI,
      catatanBab: 'Bab ini berlaku bila Anda Area Manager. Store Manager tidak menyetujui dokumen.' },
    { judul: 'Saat Anda cuti', langkah: LANGKAH_CUTI },
    { judul: 'Hal-hal lain', langkah: LANGKAH_KELUAR },
  ],
};

// ============================================================================
//  Jalur BACK OFFICE
// ============================================================================
const BACKOFFICE = {
  kode: 'backoffice',
  judul: 'Panduan EAPEX untuk Back Office',
  subjudul: 'Kantor Pusat - HC, Marketing, Accounting',
  ringkas: `Panduan ini untuk Anda yang bertugas di Kantor Pusat. Rantai
            persetujuannya lebih pendek daripada cabang: langsung ke atasan
            Anda, lalu Accounting, lalu CEO.`,
  wilayah: 'back_office',
  bab: [
    { judul: 'Masuk pertama kali', langkah: null },
    {
      judul: 'Mengenal layarnya',
      langkah: [
        {
          judul: 'Dasbor',
          isi: `Halaman pertama setelah masuk. Memuat ringkasan pengajuan Anda:
                yang masih berjalan, yang disetujui, dan yang perlu diperbaiki.`,
          gambar: 'dasbor',
          ketGambar: 'Dasbor',
        },
        {
          judul: 'Menu sebelah kiri',
          isi: `<b>Dasbor</b> - ringkasan.<br>
                <b>Pengajuan Baru</b> - membuat dokumen.<br>
                <b>Daftar Pengajuan</b> - semua dokumen Anda, bisa diunduh ke Excel.<br>
                <b>Kotak Approval</b> - hanya muncul bila Anda punya wewenang menyetujui.<br>
                <b>Notifikasi</b> - riwayat pemberitahuan.<br>
                <b>Cuti Saya</b> - mengatur ketidakhadiran.`,
        },
      ],
    },
    { judul: 'Membuat pengajuan', langkah: null },
    { judul: 'Menyetujui pengajuan', langkah: LANGKAH_MENYETUJUI,
      catatanBab: 'Bab ini berlaku bila Anda Manager, HC Manager, atau Marketing Coordinator.' },
    { judul: 'Saat Anda cuti', langkah: LANGKAH_CUTI },
    { judul: 'Hal-hal lain', langkah: LANGKAH_KELUAR },
  ],
};

// --------------------------------------------------- langkah pengisian borang
// Bentuk formulir yang berbeda menuntut kolom yang berbeda. Daftar kolom WAJIB
// di bawah diambil dari lib/formulir.js supaya tidak berbeda dengan aplikasinya.
const BENTUK = {
  capex: {
    nama: 'CAPEX / Aset',
    wajib: ['Nama proyek', 'Tujuan pengadaan', 'Kategori aset', 'Deskripsi barang/pekerjaan',
      'Lokasi penempatan', 'Vendor', 'Jadwal kebutuhan', 'Penjelasan kebutuhan', 'Justifikasi'],
    opsional: 'Pengiriman, instalasi, biaya lain boleh nol. Sales tambahan dan margin hanya diisi bila pengadaan ini memang menambah penjualan - AC ruang kasir tidak menambah omzet, dan memaksakan angkanya justru membuat analisanya bohong.',
  },
  barang: {
    nama: 'Perlengkapan / Inventaris',
    wajib: ['Jalur pengadaan', 'Penjelasan', 'Justifikasi'],
    opsional: 'Rincian barang diisi baris per baris: nama, jumlah, satuan, harga satuan. Totalnya dihitung sendiri.',
  },
  biaya: {
    nama: 'Biaya',
    wajib: ['Penjelasan', 'Vendor', 'Periode', 'Justifikasi'],
    opsional: 'Rincian biaya diisi baris per baris.',
  },
  perjalanan: {
    nama: 'Perjalanan Dinas',
    wajib: ['Kota tujuan', 'Keperluan', 'Tanggal mulai', 'Tanggal selesai', 'Peserta',
      'Moda transportasi', 'Justifikasi'],
    opsional: 'Tanggal selesai tidak boleh mendahului tanggal mulai - sistem menolaknya.',
  },
  maintenance: {
    nama: 'Maintenance Bangunan',
    wajib: ['Lokasi', 'Jenis pekerjaan', 'Vendor', 'Penjelasan', 'Tanggal rencana', 'Justifikasi'],
    opsional: '',
  },
  refund: {
    nama: 'Refund Dana',
    wajib: ['Nominal refund', 'Nama penerima dana', 'Bank', 'Nomor rekening tujuan',
      'Nomor nota', 'Alasan refund'],
    opsional: 'Periksa ulang nomor rekening. Salah satu angka berarti dana masuk ke orang lain, dan menariknya kembali bukan urusan aplikasi ini.',
  },
  pindah_area: {
    nama: 'Perpindahan Area',
    wajib: ['Area tujuan', 'Nama karyawan', 'Jabatan karyawan', 'Tanggal pindah', 'Penjelasan'],
    opsional: 'Persetujuan pertama justru dari Area Manager TUJUAN, bukan area asal.',
  },
};

module.exports = { CABANG, BACKOFFICE, BENTUK, LANGKAH_MASUK, rupiah };
