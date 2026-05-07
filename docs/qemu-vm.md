# QEMU Full-Emulation Dev Server (Full Loop)

The planet app runs inside an **Alpine Linux 3.20** QEMU VM with **TCG full emulation** (no KVM). This provides a **deterministic, hermetic** environment — the full debug loop.

**У нас два цикла отладки:**
- **Быстрый цикл (host):** `npm run dev` — Vite dev server на хосте, HMR, для итераций кода
- **Полный цикл (QEMU VM):** этот документ — build + QEMU + deploy, для детерминизма

Финальная проверка перед коммитом всегда в полном цикле. 95% разработки — в быстром цикле на хосте.
Подробнее о выборе цикла — в `CLAUDE.md`.

## Quick Start

```bash
# Build the VM image from scratch (fast: prepares overlay + seed.iso)
./scripts/build-vm.sh

# Boot the VM
./scripts/boot-vm.sh

# Or build + install packages (slow: ~15 min in TCG)
./scripts/build-vm.sh --build
```

The first time, or after `--clean`, you need to build the image:

| Step | Command | Time |
|------|---------|------|
| Prepare overlay + boot config | `./scripts/build-vm.sh` | ~5 sec |
| Install packages (Node.js, npm, curl) | `./scripts/build-vm.sh --build` | ~15 min (TCG) |
| Normal boot | `./scripts/boot-vm.sh` | ~60-80 sec |

### Files

All VM files live in `qemu-vm/` (gitignored) and `scripts/`:

| File | Purpose | In git |
|------|---------|--------|
| `scripts/build-vm.sh` | Deterministic build script | Yes |
| `scripts/boot-vm.sh` | Boot script | Yes |
| `qemu-vm/overlay.raw` | Writable Alpine Linux disk image (2 GB) | No (built) |
| `qemu-vm/seed.iso` | cloud-init NoCloud datasource (374 KB) | No (built) |
| `qemu-vm/nocloud_alpine-*.qcow2` | Base Alpine cloud image (179 MB) | No (downloaded) |

Generated files are listed in `.gitignore` and never committed.

## Deterministic Build

`build-vm.sh` reproduces the exact same image given the same Alpine version:

```
./scripts/build-vm.sh          # Phase 1: download base, create overlay, seed.iso
./scripts/build-vm.sh --build  # Phase 2: boot QEMU, install packages, verify
./scripts/build-vm.sh --clean  # Remove all generated artifacts
```

**Phase 1** (fast, no VM boot):
1. Downloads Alpine 3.20 cloud image (`nocloud_alpine-3.20.3-x86_64-cloudimg.qcow2`)
2. Creates thin qcow2 overlay, converts to raw
3. Writes `ds=nocloud` to `/boot/extlinux.conf` via debugfs
4. Generates `seed.iso` with cloud-init NoCloud datasource

**Phase 2** (slow, runs QEMU):
1. Boots QEMU with `-no-reboot` flag
2. Watches serial console for cloud-init completion
3. Cloud-init installs: `nodejs`, `npm`, `curl`
4. Configures SSH (key + password auth)
5. Sets `PermitRootLogin yes`
6. Shuts down on completion
7. Verifies installed packages via debugfs

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QEMU_DIR` | `qemu-vm/` | Target directory for VM files |
| `ALPINE_VERSION` | `3.20.3` | Alpine release to use |
| `SSH_PUBKEY` | agent@ubuntu-with-agents | SSH key to inject |

## How It Works

### Boot Chain

1. QEMU boots Alpine cloud image (`overlay.raw`) via SeaBIOS + SYSLINUX
2. `extlinux.conf` passes `ds=nocloud` to the kernel (set by build-vm.sh)
3. Alpine initramfs mounts root (`LABEL=/`) from the disk
4. Cloud-init NoCloud datasource reads `seed.iso` (CDROM label `cidata`)
5. Cloud-init installs packages, sets up SSH

### Port Forwarding

| Host | Guest | Service |
|------|-------|---------|
| `:8080` | `:8080` | Planet app (npm run dev) |
| `:2222` | `:22` | SSH (root/planet) |

## Access

- **Web**: http://79.139.138.87:8080/
- **SSH**: `ssh root@localhost -p 2222` (password: `planet`)
- **Console**: Serial console output appears in the QEMU terminal

## Running the Dev Server

The dev server runs **inside the QEMU VM**. Host port `:8080` forwards to guest `:8080`.

### First deploy (after VM boot)

```bash
# 1. Build the frontend
cd /home/agent/planet && npm run build

# 2. Package and upload
tar czf /home/agent/qemu-vm/planet.tgz dist/
scp -P 2222 /home/agent/qemu-vm/planet.tgz root@localhost:/opt/

# 3. Extract and serve inside the VM
ssh root@localhost -p 2222 "cd /opt && tar xzf planet.tgz && nohup python3 -m http.server 8080 --directory dist/ &"

# 4. Open http://79.139.138.87:8080/
```

### Redeploy (after code changes)

```bash
npm run build && tar czf /home/agent/qemu-vm/planet.tgz dist/ && \
  scp -P 2222 /home/agent/qemu-vm/planet.tgz root@localhost:/opt/ && \
  ssh root@localhost -p 2222 \
    "cd /opt && tar xzf planet.tgz && \
     pkill -f 'python3 -m http.server' 2>/dev/null; \
     nohup python3 -m http.server 8080 --directory dist/ &"
```

### Notes

- VM takes ~60-80 seconds to boot (cloud-init + SSH)
- Port 8080 connection resets during boot — wait for SSH to respond
- Kill the HTTP server inside VM: `ssh root@localhost -p 2222 "pkill -f http.server"`

## Troubleshooting

**Build hangs on package install**: The VM is slow in TCG. Wait 15+ minutes. Check QEMU process: `ps aux | grep qemu`.

**Port 8080 connection reset**: Boot or cloud-init still running. Wait for console output.

**Need clean rebuild**: `./scripts/build-vm.sh --clean && ./scripts/build-vm.sh --build`

**SSH connection refused**: VM still booting. Wait 60-80 seconds.
