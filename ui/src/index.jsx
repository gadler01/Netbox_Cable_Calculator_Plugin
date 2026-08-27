import { createRoot } from "react-dom/client";
import App from "./App";

const el = document.getElementById("cable-calc-root");
if (el) {
  createRoot(el).render(
    <App
      racks={window.NETBOX_RACKS      ?? []}
      devices={window.NETBOX_DEVICES  ?? []}
      cfg={window.NETBOX_CFG          ?? {}}
      siteTree={window.NETBOX_SITE_TREE ?? []}
      selected={window.NETBOX_SELECTED  ?? {}}
    />
  );
}
