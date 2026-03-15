# OCI Deployment Scripts (No App Code Changes)

These scripts deploy the existing `wedding-gallery` app to an Oracle Cloud VM with a fixed Reserved Public IP.

## Files

- `provision_vm.sh`: first-time provisioning on the OCI VM
- `redeploy.sh`: update dependencies/build and restart services
- `sync_to_vm.sh`: copy local project to VM (run from your Mac)

## 1. Prerequisites

1. OCI VM is running (Ubuntu recommended).
2. Reserved Public IP is attached to VM.
3. OCI Security List/NSG allows:
   - TCP `22` (SSH)
   - TCP `80` (HTTP)
4. Your project is available at `/home/ubuntu/wedding-gallery` on VM.

## 2. Copy Project From Mac

From local machine:

```bash
cd /Users/aadhikari/Downloads/workspace/wedding-gallery
chmod +x ops/oci/sync_to_vm.sh
./ops/oci/sync_to_vm.sh ubuntu@<RESERVED_PUBLIC_IP> /home/ubuntu/wedding-gallery
```

## 3. First-Time VM Provisioning

On VM:

```bash
cd /home/ubuntu/wedding-gallery
chmod +x ops/oci/provision_vm.sh ops/oci/redeploy.sh
PUBLIC_IP=<RESERVED_PUBLIC_IP> RUN_INDEXING=0 ./ops/oci/provision_vm.sh
```

Optional flags:

- `RUN_INDEXING=1` to run `index_faces.py --index-only` during provisioning
- `INSTALL_SYSTEM_PACKAGES=0` to skip apt install
- `PROJECT_DIR=/custom/path` if project is not under `/home/ubuntu/wedding-gallery`
- `APP_USER=ubuntu` (default)

## 4. Fixed URL

Use:

```text
http://<RESERVED_PUBLIC_IP>
```

This stays fixed as long as the reserved IP remains attached.

## 5. Redeploy After Changes

1. Sync again from local:

```bash
./ops/oci/sync_to_vm.sh ubuntu@<RESERVED_PUBLIC_IP> /home/ubuntu/wedding-gallery
```

2. On VM:

```bash
cd /home/ubuntu/wedding-gallery
FORCE_FRONTEND_BUILD=1 RUN_INDEXING=0 ./ops/oci/redeploy.sh
```

## 6. Service Logs

```bash
sudo journalctl -u wedding-backend.service -f
sudo journalctl -u wedding-frontend.service -f
sudo systemctl status wedding-backend.service wedding-frontend.service nginx
```

## 7. Important Note About Free Tier

OCI Always Free compute can still be reclaimed if Oracle marks it idle.  
Your fixed IP can remain fixed, but VM availability is not an absolute guarantee on free tier.

