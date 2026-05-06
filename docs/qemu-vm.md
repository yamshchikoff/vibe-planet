# QEMU Full-Emulation Dev Server

The planet app runs inside an **Alpine Linux 3.20** QEMU VM with **TCG full emulation** (no KVM). This provides a reproducible, isolated environment that matches production-like conditions.

## Quick Start

```bash
cd /home/agent/qemu-vm

# Start the VM
./boot-vm.sh

# Wait ~60-80s for boot + cloud-init
# App becomes available at:
#   http://localhost:8080/    (local)
#   http://79.139.138.87:8080/ (external)
```

## How It Works

### Boot Chain

1. QEMU boots Alpine cloud image (`overlay.raw`) via SeaBIOS + SYSLINUX
2. `extlinux.conf` passes `ds=nocloud` to the kernel (modified in overlay)
3. Alpine initramfs mounts root (`LABEL=/`) from the disk
4. Cloud-init NoCloud datasource reads `seed.iso` (CDROM label `cidata`)
5. Cloud-init runs: downloads tarball → extracts to `/opt/dist/` → starts Python HTTP server

### Files

| File | Purpose |
|------|---------|
| `alpine.qcow2` | Base Alpine Linux 3.20 cloud image (179 MB) |
| `overlay.raw` | Writable overlay with boot config modified (`ds=nocloud`) |
| `seed.iso` | cloud-init NoCloud datasource (user-data + meta-data) |
| `user-data` | cloud-init config: packages, runcmd, dev server setup |
| `meta-data` | cloud-init instance metadata |
| `planet.tgz` | Project tarball (built dist/ + source) |
| `vmlinuz-virt` | Alpine virt kernel (used for netboot, not required now) |
| `initramfs-virt` | Alpine virt initramfs (used for netboot, not required now) |
| `boot-vm.sh` | Boot script |
| `vm.log` | VM serial console output |

### Port Forwarding

| Host | Guest | Service |
|------|-------|---------|
| `:8080` | `:8080` | Python HTTP server (planet app) |
| `:2222` | `:22` | SSH (root/planet) |

## Rebuilding

### After user-data changes

```bash
# Regenerate seed ISO
rm -f seed.iso
genisoimage -output seed.iso -volid cidata -joliet -rock /tmp/seed-new/
```

### After project changes

```bash
# 1. Build production version
cd /home/agent/planet && npm run build

# 2. Recreate tarball
tar czf /home/agent/qemu-vm/planet.tgz \
  --exclude=node_modules --exclude=.git \
  dist src package.json package-lock.json tsconfig.json vite.config.ts public

# 3. Delete old overlay for clean boot
rm -f overlay.raw overlay.qcow2
qemu-img create -f qcow2 -F qcow2 -b alpine.qcow2 overlay.qcow2
qemu-img convert -O raw overlay.qcow2 overlay.raw

# 4. Add ds=nocloud to boot config
debugfs -w overlay.raw << 'EOF'
rm /boot/extlinux.conf
write /tmp/extlinux-new2.conf /boot/extlinux.conf
EOF

# 5. Reboot VM
```

## First-Time Setup

If starting from scratch:

```bash
# Create overlay
qemu-img create -f qcow2 -F qcow2 -b alpine.qcow2 overlay.qcow2
qemu-img convert -O raw overlay.qcow2 overlay.raw

# Modify boot config for ds=nocloud
debugfs -w overlay.raw << 'EOF'
rm /boot/extlinux.conf
write modified-extlinux.conf /boot/extlinux.conf
EOF

# Create seed ISO
genisoimage -output seed.iso -volid cidata -joliet -rock seed-data/

# Start tarball HTTP server
python3 -m http.server 8099 &
```

## Access

- **Web**: http://79.139.138.87:8080/
- **SSH**: `ssh root@localhost -p 2222` (password: `planet`)
- **Console**: `cat vm.log` (serial console log)

## Troubleshooting

**Port 8080 connection reset**: The cloud-init runcmd may still be running. Wait for `Cloud-init ... finished` in `vm.log`.

**No HTTP response**: Check `grep "Python server" vm.log`. If missing, cloud-init runcmd failed.

**Need fresh boot**: Delete `overlay.raw`, recreate steps above.
