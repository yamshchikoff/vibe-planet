#!/bin/bash
# Build the QEMU full-emulation dev image from scratch
# Usage:
#   ./scripts/build-vm.sh              # prepare only (fast: overlay + seed.iso)
#   ./scripts/build-vm.sh --build      # prepare + boot QEMU to install packages (~15 min in TCG)
#   ./scripts/build-vm.sh --clean      # remove all generated artifacts
#
# Deterministic: same inputs always produce the same image.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
QEMU_DIR="${QEMU_DIR:-$SCRIPT_DIR/qemu-vm}"
ALPINE_VERSION="${ALPINE_VERSION:-3.20.10}"
ALPINE_IMAGE="generic_alpine-${ALPINE_VERSION}-x86_64-bios-cloudinit-r0.qcow2"
ALPINE_URL="https://dl-cdn.alpinelinux.org/alpine/v3.20/releases/cloud/${ALPINE_IMAGE}"

EXT4_LABEL="${EXT4_LABEL:-/}"
SSH_PUBKEY="${SSH_PUBKEY:-ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB1PoYsgFMbEmdT5uuOCuLran2gOiUchfe7uQsUQPH34 agent@ubuntu-with-agents}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

cleanup() {
    info "Cleaning up generated artifacts in ${QEMU_DIR}"
    rm -f "${QEMU_DIR}/overlay.raw" "${QEMU_DIR}/seed.iso" "${QEMU_DIR}/${ALPINE_IMAGE}"
    rm -f "${QEMU_DIR}/overlay.qcow2"
    info "Cleanup done."
}

prepare() {
    mkdir -p "${QEMU_DIR}"

    # Step 1: Download Alpine cloud image if not present
    if [ ! -f "${QEMU_DIR}/${ALPINE_IMAGE}" ]; then
        info "Downloading Alpine ${ALPINE_VERSION} cloud image..."
        wget -q --show-progress -O "${QEMU_DIR}/${ALPINE_IMAGE}" "${ALPINE_URL}"
    else
        info "Alpine cloud image already present"
    fi

    # Step 2: Create overlay
    local overlay_raw="${QEMU_DIR}/overlay.raw"
    local overlay_qcow2="${QEMU_DIR}/overlay.qcow2"
    if [ -f "${overlay_raw}" ]; then
        info "Overlay ${overlay_raw} already exists, skipping"
    else
        info "Creating overlay (thin qcow2 + convert to raw)..."
        qemu-img create -f qcow2 -F qcow2 \
            -b "${QEMU_DIR}/${ALPINE_IMAGE}" \
            "${overlay_qcow2}" 2>&1
        qemu-img convert -O raw "${overlay_qcow2}" "${overlay_raw}"
        rm -f "${overlay_qcow2}"
        info "Overlay created: $(du -h "${overlay_raw}" | cut -f1)"
    fi

    # Step 3: Write ds=nocloud to extlinux.conf
    info "Setting ds=nocloud in extlinux.conf..."
    local extlinux_conf
    extlinux_conf=$(mktemp)
    cat > "${extlinux_conf}" << 'EXTLINUX'
serial 0
default l0
timeout 10
label l0
    linux /boot/vmlinuz-virt
    initrd /boot/initramfs-virt
    append root=LABEL=/ console=ttyS0 ds=nocloud
EXTLINUX

    debugfs -w -R "rm /boot/extlinux.conf" "${overlay_raw}" 2>/dev/null || true
    debugfs -w -R "write ${extlinux_conf} /boot/extlinux.conf" "${overlay_raw}"
    rm -f "${extlinux_conf}"

    # Verify
    local verify
    verify=$(debugfs -R "cat /boot/extlinux.conf" "${overlay_raw}" 2>/dev/null)
    if ! echo "${verify}" | grep -q "ds=nocloud"; then
        error "Failed to set ds=nocloud in extlinux.conf"
        exit 1
    fi
    info "ds=nocloud verified in extlinux.conf"

    # Step 4: Create seed.iso with NoCloud datasource
    info "Creating seed.iso with cloud-init config..."
    local seed_dir
    seed_dir=$(mktemp -d)

    cat > "${seed_dir}/meta-data" << META
instance-id: planet-vm-base-v5
local-hostname: planet-vm
META

    cat > "${seed_dir}/user-data" << USERDATA
#cloud-config
password: planet
chpasswd:
  list: |
    root:planet
  expire: False
ssh_pwauth: true
disable_root: false
ssh_authorized_keys:
  - ${SSH_PUBKEY}
bootcmd:
  - [ sh, -c, 'echo "nameserver 10.0.2.3" > /etc/resolv.conf' ]
  - [ sh, -c, 'sed -i "s|https://|http://|g" /etc/apk/repositories' ]
runcmd:
  - echo "--- Installing packages (this may take a while in TCG) ---" > /dev/ttyS0
  - apk add --no-cache nodejs npm curl 2>&1 | tee /dev/ttyS0
  - echo "--- Verifying packages ---" > /dev/ttyS0
  - node --version > /opt/node_version 2>&1
  - npm --version >> /opt/node_version 2>&1
  - curl --version | head -1 >> /opt/node_version 2>&1
  - cat /opt/node_version > /dev/ttyS0
  - echo "PermitRootLogin yes" > /etc/ssh/sshd_config.d/99-permit-root.conf
  - echo "--- All packages installed, image ready ---" > /dev/ttyS0
USERDATA

    rm -f "${QEMU_DIR}/seed.iso"
    genisoimage -output "${QEMU_DIR}/seed.iso" \
        -volid cidata -joliet -rock "${seed_dir}/" 2>/dev/null
    rm -rf "${seed_dir}"
    info "seed.iso created: $(du -h "${QEMU_DIR}/seed.iso" | cut -f1)"

    info "Preparation complete."
    info "  overlay.raw: ${QEMU_DIR}/overlay.raw"
    info "  seed.iso:    ${QEMU_DIR}/seed.iso"
    echo ""
    info "Run with --build to boot QEMU and install packages (~15 min in TCG)."
    info "Or run manually: ${SCRIPT_DIR}/scripts/boot-vm.sh"
}

build() {
    local overlay_raw="${QEMU_DIR}/overlay.raw"
    local seed_iso="${QEMU_DIR}/seed.iso"

    if [ ! -f "${overlay_raw}" ] || [ ! -f "${seed_iso}" ]; then
        error "Run without --build first to prepare overlay and seed.iso"
        exit 1
    fi

    local vm_log
    vm_log=$(mktemp /tmp/vm-build-XXXXX.log)

    info "Booting QEMU (this takes ~10-15 minutes in TCG)..."
    info "Monitor: ${vm_log}"

    qemu-system-x86_64 \
        -machine type=pc \
        -cpu qemu64 \
        -m 1G \
        -smp 1 \
        -drive file="${overlay_raw}",format=raw,if=virtio \
        -cdrom "${seed_iso}" \
        -nic user,model=virtio-net-pci,hostfwd=tcp::8080-:8080,hostfwd=tcp::2222-:22 \
        -device virtio-rng-pci \
        -nographic \
        -no-reboot \
        2>&1 | tee "${vm_log}" &
    local vm_pid=$!

    # Wait for cloud-init to finish, watching serial output
    local ready=0
    info "Waiting for package installation to complete..."
    while kill -0 "${vm_pid}" 2>/dev/null; do
        if grep -q "All packages installed, image ready" "${vm_log}" 2>/dev/null; then
            ready=1
            info "Package installation complete. Shutting down..."
            # Give QEMU a moment to flush writes
            sleep 3
            break
        fi
        sleep 5
    done

    wait "${vm_pid}" 2>/dev/null || true

    if [ "${ready}" -eq 0 ]; then
        # Check if we got shutdown before completion
        if grep -q "reboot\|Power down" "${vm_log}" 2>/dev/null; then
            error "VM shut down unexpectedly. Check ${vm_log}"
        else
            error "VM did not complete. Check ${vm_log}"
        fi
        rm -f "${vm_log}"
        exit 1
    fi

    # Verify packages via debugfs
    info "Verifying installed packages..."
    local node_version npm_version
    node_version=$(debugfs -R "cat /opt/node_version" "${overlay_raw}" 2>/dev/null | head -1)
    npm_version=$(debugfs -R "cat /opt/node_version" "${overlay_raw}" 2>/dev/null | sed -n '2p')

    if [ -n "${node_version}" ]; then
        info "Node.js: ${node_version}"
    else
        warn "Node.js version not found in image"
    fi
    if [ -n "${npm_version}" ]; then
        info "npm:     ${npm_version}"
    fi

    rm -f "${vm_log}"
    info "Build complete. Image is at: ${overlay_raw}"
    info "Boot with: ${SCRIPT_DIR}/scripts/boot-vm.sh"
}

# --- Main ---

case "${1:-}" in
    --clean)
        cleanup
        ;;
    --build)
        build
        ;;
    --help|-h)
        echo "Usage: $0 [--build|--clean|--help]"
        echo ""
        echo "  (no args)  Prepare overlay.raw + seed.iso (fast)"
        echo "  --build    Prepare + boot QEMU to install packages"
        echo "  --clean    Remove all generated artifacts"
        ;;
    *)
        prepare
        ;;
esac
