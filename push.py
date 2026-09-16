#!/usr/bin/env python3
"""Kirim perubahan Peta GIS Wilayah ke GitHub (add + commit + push).

Bisa dijalankan dengan double-click file ini di File Explorer, atau lewat
terminal: python push.py

Proses git push tetap akan membuka jendela browser untuk login GitHub kalau
diperlukan -- itu bagian dari git sendiri, bukan sesuatu yang bisa diganti.
"""
import datetime
import os
import subprocess
import sys

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
# Pakai git portable yang sama dengan aplikasi Tally Sheet (satu folder di atas)
PORTABLE_GIT_BIN = os.path.join(PROJECT_DIR, "..", "_tools", "PortableGit", "bin")
PORTABLE_GIT_CMD = os.path.join(PROJECT_DIR, "..", "_tools", "PortableGit", "cmd")
GIT_EXE = os.path.join(PORTABLE_GIT_CMD, "git.exe")


def run(args):
    """args[0] harus 'git' -- diganti ke path lengkap git.exe portable
    karena subprocess di Windows tidak mencari PATH milik child env,
    hanya PATH proses Python sendiri."""
    full_args = [GIT_EXE, *args[1:]]
    print(">", " ".join(args))
    env = os.environ.copy()
    env["PATH"] = PORTABLE_GIT_BIN + os.pathsep + PORTABLE_GIT_CMD + os.pathsep + env.get("PATH", "")
    result = subprocess.run(full_args, cwd=PROJECT_DIR, env=env)
    return result.returncode


def main():
    print(f"Folder proyek: {PROJECT_DIR}\n")

    if not os.path.isdir(os.path.join(PROJECT_DIR, ".git")):
        print("Folder ini belum jadi repo git, atau belum ada remote GitHub.")
        print("Jalankan dulu: git remote add origin <URL_REPO_GITHUB_ANDA>")
        return

    status_code = run(["git", "status", "--short"])
    if status_code != 0:
        print("\nGagal membaca status git.")
        return

    add_code = run(["git", "add", "-A"])
    if add_code != 0:
        print("\nGagal menjalankan git add.")
        return

    check = subprocess.run([GIT_EXE, "diff", "--cached", "--quiet"], cwd=PROJECT_DIR)
    if check.returncode == 0:
        print("\nTidak ada perubahan baru untuk di-commit. Lanjut coba push saja...")
    else:
        default_msg = f"Update {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}"
        msg = input(f"\nPesan commit (kosongkan untuk pakai default: '{default_msg}'): ").strip()
        if not msg:
            msg = default_msg
        commit_code = run(["git", "commit", "-m", msg])
        if commit_code != 0:
            print("\nGagal commit.")
            return

    print("\nMengirim ke GitHub (git push)... jendela browser mungkin akan terbuka untuk login.")
    push_code = run(["git", "push", "-u", "origin", "main"])
    if push_code == 0:
        print("\nBerhasil terkirim ke GitHub.")
    else:
        print("\nPush gagal. Lihat pesan error di atas -- kemungkinan remote 'origin' belum diatur:")
        print("  git remote add origin <URL_REPO_GITHUB_ANDA>")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nTerjadi error: {e}")
    input("\nTekan Enter untuk menutup jendela ini...")
