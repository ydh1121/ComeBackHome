using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "crypto-probe", worker = (
    modules = [(name = "probe.mjs", esModule = embed "crypto-probe.mjs")],
    compatibilityDate = "2026-10-06",
    compatibilityFlags = ["nodejs_compat"]
  ))]
);
