# FlyCraft（果蝇连接组 → Minecraft 控制 MVP）

用**稀疏神经图动力学**把 Minecraft 事件映射到脚本化躯体程序的最小可运行原型。默认使用合成小图 fixture，**不下载**完整 MaleCNS 数据，**不依赖**未发布的 NeuroCraft mod，无 Minecraft 也可跑 headless 演示。

> **声明**：本项目为工程原型，**不声称**系统有意识，也**不声称**会学习玩 Minecraft。动力学是固定图上的简单速率/LIF 步进 + 读出，不是训练好的策略网络。

## 架构

```
Minecraft events → sensory encoding → sparse neural dynamics on graph
    → motor readouts → scripted body programs → Minecraft actions
```

| 层 | 作用 |
|----|------|
| `bridge` | Event / Action 契约（JSON） |
| `neural/encode` | 事件 → 感觉神经元电流 |
| `neural/dynamics` | 图上 rate 或 LIF 步进 |
| `neural/decode` | 运动池 → 躯体程序分数 |
| `body/programs` | flee / approach_food / turn / jump / idle |
| `sim` | 闭环与 headless CLI |

## 快速开始

```bash
cd /workspace/flycraft
python3.11 -m venv .venv && source .venv/bin/activate   # 或系统 Python ≥3.11
pip install -e ".[dev]"

# Headless 演示（无需 Minecraft）
./scripts/run_headless.sh
# 或
python -m flycraft.sim.run_headless

# 对照：打乱突触权重
python -m flycraft.sim.run_headless --shuffle-weights

# 测试
pytest -q
```

Node Mineflayer 桩（干跑，默认不连服）：

```bash
cd /workspace/flycraft
npm install   # 可选；干跑可不装 mineflayer
node bridge-js/index.js --dry-run
```

## VPS 建议

- **系统**：Ubuntu 22.04/24.04
- **内存**：16–32 GB（fixture 很小；若日后加载真实 MaleCNS 子图再升配）
- **CPU**：4+ vCPU
- **磁盘**：≥40 GB
- 详见 [docs/vps.md](docs/vps.md)

## 数据与归属

- 默认图：`data/fixtures/tiny_graph.json` — **合成** fixture，角色标签受 MaleCNS 启发，**不是** MaleCNS 原始数据。
- MaleCNS 数据集许可为 **CC-BY**；若日后接入真实数据，请按 [data/fixtures/README.md](data/fixtures/README.md) 与官方条款署名，并单独下载（本仓库不捆绑大文件）。

## 文档

- [docs/architecture.md](docs/architecture.md) — 架构
- [docs/roadmap.md](docs/roadmap.md) — 路线图
- [docs/vps.md](docs/vps.md) — VPS
- [flycraft/bridge/protocol.md](flycraft/bridge/protocol.md) — 事件/动作协议

## License

本仓库代码：**MIT**（见 [LICENSE](LICENSE)）。MaleCNS 数据（若使用）：**CC-BY**，需单独归属。

---

## English

**FlyCraft** is an MIT-licensed MVP that maps Minecraft-like events through a small sparse neural graph to scripted body programs. Default data is a **synthetic** ~20–50 node fixture inspired by MaleCNS role labels — not the full connectome, and not a claim of consciousness or Minecraft learning.

```bash
pip install -e ".[dev]"
python -m flycraft.sim.run_headless
pytest -q
```

Optional Mineflayer stub: `node bridge-js/index.js --dry-run` (`MC_HOST` left as TODO). NeuroCraft mod is unreleased — this project does not depend on it.

## 真人服 fight / flee 演示

这是**固定合成 fixture 图动力学 + 明示工程规则**的现场演示，不是训练得到的 Minecraft 技能：附近敌对生物且血量正常时选择 `fight`，受伤或血量 ≤ 9 时优先 `flee`。

```bash
# 终端 1：Paper（server.properties 已开仅本机演示用 RCON）
cd /workspace/mc-server
tmux new -s flycraft-server ./start.sh
# 看到 Done 后用 Ctrl-b d 脱离 tmux

# 终端 2：运行一个 FlyBot，默认 60 秒；自动召唤僵尸并稍后扣血
cd /workspace/flycraft
./scripts/run_live_demo.sh
```

可设置 `LIVE_DURATION=120` 延长，或 `FLYCRAFT_SUMMON=0` 禁用自动测试怪物。单独发命令：

```bash
./scripts/rcon.py 'execute at FlyBot run summon zombie ~3 ~ ~ {PersistenceRequired:1b}'
```

停止机器人按 `Ctrl-C`；停止服务器：`tmux send-keys -t flycraft-server stop Enter`（或进入 tmux 后输入 `stop`）。服务仅为本机离线模式测试，不应暴露到公网。
