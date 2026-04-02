# Setup

Prerequisites:
- Docker, installed and running
- VS Code extensions: [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers), [Remote - WSL](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-wsl), [Docker](https://marketplace.visualstudio.com/items?itemName=ms-azuretools.vscode-docker)

## Windows

You can choose preffered way on how to install docker in Windows, Docker Desktop application or Docker in WSL.

### Docker Desktop

Install Docker Desktop for Windows and enable WSL 2 integration:

- Download and install Docker Desktop: [instructions](https://docs.docker.com/desktop/windows/install/)
- Start Docker Desktop and accept the installer prompts (enable WSL 2 if requested)
- In Docker Desktop: Settings -> Resources -> WSL Integration -> enable integration for your distro

### Docker Engine as WSL service

- Enable WSL and install a Linux distro
  ```powershell
  wsl --install
  ```
- Install git and clone this repository
- Start docker or intall, if not already, same way as it is done for Linux
  ```powershell
  wsl
  ```

**Notes:**
- To open project open `wsl`, start docker `sudo service docker start` and then `code <apath-to-repo>` to open Visual Studio Code in dev container mode.

## macOS

You can choose preffered way on how to install docker in macOS, Docker Desktop application or Docker Engine Colima.

### Docker Desktop

If you prefer Docker Desktop on macOS (instead of Colima):

- Download and install Docker Desktop for Mac: [instructions](https://docs.docker.com/desktop/mac/install/)
- Open Docker Desktop and follow the onboarding steps

### Docker Colima

Colima is lightweight replacement for Docker Desktop with the Docker CLI. Install and start Colima:

```bash
brew install colima docker
colima start --runtime docker
```

## Linux/Debian

If you run Debian or a Debian-based distro, install Docker Engine with the official repository:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] \
  https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io
sudo usermod -aG docker $USER
newgrp docker
```