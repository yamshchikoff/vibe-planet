#!/bin/bash
# Boot the QEMU full-emulation VM and expose the dev server on host port 8080.
#
# Prerequisites:
#   /home/agent/qemu-vm/ must be set up with overlay.raw and seed.iso
#   (run ./scripts/build-vm.sh to prepare)
#
# After boot (~60-80s):
#   1. Upload tarball: scp -P 2222 /home/agent/qemu-vm/planet.tgz root@localhost:/opt/
#   2. Start server:   ssh root@localhost -p 2222 "cd /opt && tar xzf planet.tgz && nohup python3 -m http.server 8080 --directory dist/ &"
#   3. Open:           http://79.139.138.87:8080/
#
# See docs/qemu-vm.md for full workflow.
set -e
QEMU_DIR="${QEMU_DIR:-/home/agent/qemu-vm}"
if [ ! -f "$QEMU_DIR/overlay.raw" ]; then
  echo "Error: QEMU setup not found in $QEMU_DIR"
  echo "See docs/qemu-vm.md for first-time setup instructions."
  exit 1
fi
cd "$QEMU_DIR"
exec qemu-system-x86_64 \
  -machine type=pc \
  -cpu qemu64 \
  -m 1G \
  -smp 1 \
  -drive file=overlay.raw,format=raw,if=virtio \
  -cdrom seed.iso \
  -nic user,model=virtio-net-pci,hostfwd=tcp::8080-:8080,hostfwd=tcp::2222-:22 \
  -device virtio-rng-pci \
  -nographic \
  "$@"
