#!/usr/bin/env bash
# 림버스 MOBA 서버 한 번에 설치 · 업데이트 (Oracle Cloud Ubuntu 기준)
# 처음 설치도, 나중에 업데이트도 이 명령 하나:
#   curl -fsSL https://raw.githubusercontent.com/dineer0919-tech/limbus-moba/main/server/setup.sh | sudo bash
main() {
set -e
REPO="${REPO:-https://github.com/dineer0919-tech/limbus-moba}"
GAME_URL="${GAME_URL:-https://dineer0919-tech.github.io/limbus-moba/}"
DIR=/opt/limbus-moba
say() { echo; echo "==> $*"; }

if [ "$(id -u)" != 0 ]; then echo "sudo 를 붙여서 실행해 주세요"; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

say "필요한 프로그램 설치 (처음 한 번만 오래 걸려요)"
apt-get update -y >/dev/null
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent >/dev/null || apt-get install -y curl git ca-certificates gnupg >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y >/dev/null && apt-get install -y caddy >/dev/null
fi
echo "node $(node -v) · $(caddy version | cut -d' ' -f1)"

say "서버 파일 받기 (GitHub)"
id moba >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin moba
if [ -d "$DIR/.git" ]; then git -C "$DIR" fetch -q --depth 1 origin && git -C "$DIR" reset -q --hard FETCH_HEAD
else rm -rf "$DIR"; git clone -q --depth 1 "$REPO" "$DIR"; fi
[ -f "$DIR/server/server.js" ] || { echo "저장소에 server/server.js 가 없습니다. GitHub에 server 폴더를 올렸는지 확인해 주세요."; exit 1; }
chown -R moba:moba "$DIR"

say "방화벽 열기 (80 · 443)"
for p in 80 443; do iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport $p -j ACCEPT; done
command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true

say "주소 정하기"
IP="$(curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me)"
DOMAIN="${DOMAIN:-$(echo "$IP" | tr . -).sslip.io}"
echo "공인 IP: $IP → 주소: $DOMAIN"

say "게임 서버 등록 (꺼져도 자동으로 다시 켜짐)"
cat > /etc/systemd/system/limbus-moba.service <<EOF
[Unit]
Description=Limbus MOBA game server
After=network-online.target
Wants=network-online.target
[Service]
User=moba
WorkingDirectory=$DIR/server
Environment=PORT=8080
Environment=GAME_URL=$GAME_URL
ExecStart=/usr/bin/node $DIR/server/server.js
Restart=always
RestartSec=2
[Install]
WantedBy=multi-user.target
EOF
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8080
}
EOF
systemctl daemon-reload
systemctl enable -q limbus-moba caddy
systemctl restart limbus-moba caddy

say "확인 중 (인증서 받는 데 30초쯤 걸릴 수 있어요)"
ok=""
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
echo
if [ -n "$ok" ]; then
  echo "✅ 완료!  서버 주소:  $DOMAIN"
  curl -fsS "https://$DOMAIN/health"; echo
  echo "게임의 '서버 연결' 칸에 위 주소를 넣거나, 이 주소를 Claude에게 알려 주세요."
else
  echo "⚠️ 서버는 켜졌지만 https 확인이 아직 안 됩니다."
  echo "  1) Oracle 콘솔에서 80 · 443 포트를 열었는지 (보안 목록 수신 규칙) 확인해 주세요."
  echo "  2) 1~2분 뒤:  curl https://$DOMAIN/health"
  echo "  기록 보기:  sudo journalctl -u limbus-moba -n 50  /  sudo journalctl -u caddy -n 50"
fi
}
main "$@"
