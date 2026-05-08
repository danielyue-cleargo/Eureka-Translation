"use client";

import { useEffect, useRef, useState } from "react";
import type { Campaign, Locale, Product, Term } from "@eu-translation/shared";
import { createId, folderForTermType, libraryFolders, locales, termTypes } from "@eu-translation/shared";
import {
  cloudSyncBadgeLabel,
  cloudSyncBadgeTone,
  cloudSyncNotice,
  type CloudSyncStatus
} from "@/lib/cloud-sync-status";

type NoticeTone = "info" | "success" | "error";
type ApiConnectionStatus = {
  checking: boolean;
  configured: boolean;
  connected: boolean;
  error?: string;
  source: "runtime" | "env" | "none";
};
type SyncConflict = {
  cloudTerm?: Term;
  cloudVersion: number;
  localTerm?: Term;
  localVersion: number;
  termId: string;
  type: "delete" | "update";
};
type ProductSyncConflict = {
  cloudProduct?: Product;
  cloudVersion: number;
  localProduct?: Product;
  localVersion: number;
  productId: string;
  type: "delete" | "update";
};
type ProductUploadRow = {
  discountedPrice: number;
  priceDifference: number;
  productName: string;
  rowNumber: number;
  rrp: number;
};
const disconnectedApiStatus: ApiConnectionStatus = {
  checking: true,
  configured: false,
  connected: false,
  source: "none"
};
const LIBRARY_PAGE_SIZE = 20;
const TAG_MANAGER_PAGE_SIZE = 10;

export function Dashboard() {
  const [activePage, setActivePage] = useState<"home" | "library" | "products" | "setting">("home");
  const [sourceUrl, setSourceUrl] = useState("");
  const [syncLocalizedSources, setSyncLocalizedSources] = useState(false);
  const [localizedUrls, setLocalizedUrls] = useState<Record<Locale, string>>({ DE: "", FR: "", IT: "", ES: "" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [extractedTerms, setExtractedTerms] = useState<Term[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [savedTerms, setSavedTerms] = useState<Term[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveTagDialogOpen, setSaveTagDialogOpen] = useState(false);
  const [productSyncConflicts, setProductSyncConflicts] = useState<ProductSyncConflict[]>([]);
  const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
  const [status, setStatus] = useState("Home ready");
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("info");
  const [generationProgress, setGenerationProgress] = useState(0);
  const [apiConnections, setApiConnections] = useState<{
    figma: ApiConnectionStatus;
    openai: ApiConnectionStatus;
  }>({
    figma: disconnectedApiStatus,
    openai: disconnectedApiStatus
  });
  const [cloudSync, setCloudSync] = useState<CloudSyncStatus>({
    configured: false,
    connected: false,
    enabled: false
  });
  const isGenerating = busy === "source" || busy === "file";
  const availableTags = [...new Set(savedTerms.flatMap((term) => term.tags ?? []))].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    void loadLibrary();
    void loadProducts();
    void loadCampaigns();
    void refreshApiConnections();
    void refreshCloudSync();
    const timer = window.setInterval(() => {
      void refreshApiConnections();
    }, 60000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isGenerating) {
      setGenerationProgress(0);
      return;
    }

    setGenerationProgress(12);
    const timer = window.setInterval(() => {
      setGenerationProgress((current) => {
        if (current < 55) return current + 7;
        if (current < 82) return current + 3;
        if (current < 94) return current + 1;
        return current;
      });
    }, 500);

    return () => window.clearInterval(timer);
  }, [isGenerating]);

  useEffect(() => {
    if (busy || status === "Home ready") return;
    const timer = window.setTimeout(() => {
      setStatus("Home ready");
      setNoticeTone("info");
    }, 4200);

    return () => window.clearTimeout(timer);
  }, [busy, status]);

  function showNotice(message: string, tone: NoticeTone = "info") {
    setStatus(message);
    setNoticeTone(tone);
  }

  async function refreshApiConnections() {
    setApiConnections((current) => ({
      figma: { ...current.figma, checking: true },
      openai: { ...current.openai, checking: true }
    }));
    const [openai, figma] = await Promise.all([loadApiConnection("/api/settings/openai?verify=1"), loadApiConnection("/api/settings/figma?verify=1")]);
    setApiConnections({ figma, openai });
  }

  function cancelGeneratedTranslation() {
    setExtractedTerms([]);
    setSourceUrl("");
    setSyncLocalizedSources(false);
    setLocalizedUrls({ DE: "", FR: "", IT: "", ES: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
    showNotice("Generated translation cancelled");
  }

  async function loadLibrary() {
    const response = await fetch("/api/library");
    const data = await response.json();
    if (data.sync) setCloudSync(data.sync);
    setSavedTerms(data.terms ?? []);
  }

  async function loadProducts(campaignId = selectedCampaignId) {
    const query = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : "";
    const response = await fetch(`/api/products${query}`);
    const data = await response.json();
    if (data.sync) setCloudSync(data.sync);
    setProducts(data.products ?? []);
  }

  async function loadCampaigns() {
    const response = await fetch("/api/campaigns");
    const data = await response.json();
    setCampaigns(data.campaigns ?? []);
  }

  async function refreshCloudSync() {
    const response = await fetch("/api/sync/library");
    const data = await response.json();
    if (data.sync) setCloudSync(data.sync);
  }

  async function syncLibraryNow() {
    setBusy("cloud-sync");
    showNotice("Syncing Library with Supabase...");
    try {
      const response = await fetch("/api/sync/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Cloud sync failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        setSyncConflicts(data.conflicts);
        showNotice(`${data.conflicts.length} Library sync conflict${data.conflicts.length === 1 ? "" : "s"} need review`, "error");
        setBusy(null);
        return;
      }
      const notice = cloudSyncNotice(data.sync);
      showNotice(notice.message, notice.tone);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Cloud sync failed", "error");
    }
    setBusy(null);
  }

  async function resolveSyncConflicts(resolutions: Array<{ action: "overwrite" | "skip"; termId: string }>) {
    setBusy("cloud-sync-resolve");
    showNotice("Resolving Library sync conflicts...");
    try {
      const response = await fetch("/api/sync/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutions })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Conflict resolution failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        setSyncConflicts(data.conflicts);
        showNotice(`${data.conflicts.length} Library sync conflict${data.conflicts.length === 1 ? "" : "s"} still need review`, "error");
        setBusy(null);
        return;
      }
      setSyncConflicts([]);
      const notice = cloudSyncNotice(data.sync);
      showNotice(notice.message, notice.tone);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Conflict resolution failed", "error");
    }
    setBusy(null);
  }

  async function syncProductsNow() {
    setBusy("products-cloud-sync");
    showNotice("Syncing Products with Supabase...");
    try {
      const response = await fetch("/api/sync/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Product sync failed");
      if (data.sync) setCloudSync(data.sync);
      await loadProducts(selectedCampaignId);
      if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        setProductSyncConflicts(data.conflicts);
        showNotice(`${data.conflicts.length} Product sync conflict${data.conflicts.length === 1 ? "" : "s"} need review`, "error");
        setBusy(null);
        return;
      }
      const notice = cloudSyncNotice(data.sync);
      showNotice(notice.message, notice.tone);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Product sync failed", "error");
    }
    setBusy(null);
  }

  async function resolveProductSyncConflicts(resolutions: Array<{ action: "overwrite" | "skip"; productId: string }>) {
    setBusy("products-cloud-sync-resolve");
    showNotice("Resolving Product sync conflicts...");
    try {
      const response = await fetch("/api/sync/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutions })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Product conflict resolution failed");
      if (data.sync) setCloudSync(data.sync);
      setProducts(data.products ?? []);
      if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        setProductSyncConflicts(data.conflicts);
        showNotice(`${data.conflicts.length} Product sync conflict${data.conflicts.length === 1 ? "" : "s"} still need review`, "error");
        setBusy(null);
        return;
      }
      setProductSyncConflicts([]);
      const notice = cloudSyncNotice(data.sync);
      showNotice(notice.message, notice.tone);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Product conflict resolution failed", "error");
    }
    setBusy(null);
  }

  async function uploadProducts(rows: ProductUploadRow[], override = false, campaignId = selectedCampaignId) {
    setBusy("products-upload");
    showNotice("Saving Products...");
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, override, rows })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Product upload failed");
      if (data.sync) setCloudSync(data.sync);
      setProducts(data.products ?? []);
      showNotice(`Saved ${data.savedCount ?? rows.length} ${campaignId ? "campaign price" : "product"}${(data.savedCount ?? rows.length) === 1 ? "" : "s"}`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Product upload failed", "error");
      throw error;
    } finally {
      setBusy(null);
    }
  }

  async function addProduct(product: { discountedPrice: number; productName: string; rrp: number }): Promise<boolean> {
    setBusy("add-product");
    showNotice("Adding product...");
    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(product)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Add product failed");
      if (data.sync) setCloudSync(data.sync);
      await loadProducts(selectedCampaignId);
      showNotice("Product added", "success");
      return true;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Add product failed", "error");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function updateProduct(product: Product, campaignId = selectedCampaignId) {
    setBusy(`product-update-${product.id}`);
    showNotice("Updating Product...");
    try {
      const response = await fetch("/api/products", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          discountedPrice: product.discountedPrice,
          campaignId,
          priceDifference: product.rrp - product.discountedPrice,
          productId: product.id,
          productName: product.productName,
          rrp: product.rrp
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Product update failed");
      if (data.sync) setCloudSync(data.sync);
      setProducts(data.products ?? []);
      showNotice(campaignId ? "Campaign price updated" : "Product updated", "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Product update failed", "error");
    }
    setBusy(null);
  }

  async function deleteProduct(productId: string, campaignId = selectedCampaignId) {
    setBusy(`product-delete-${productId}`);
    showNotice("Deleting Product...");
    try {
      const response = await fetch("/api/products", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, productId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Product delete failed");
      if (data.sync) setCloudSync(data.sync);
      setProducts(data.products ?? []);
      showNotice(campaignId ? "Campaign price removed" : "Product deleted", "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Product delete failed", "error");
    }
    setBusy(null);
  }

  async function selectCampaign(campaignId: string) {
    setSelectedCampaignId(campaignId);
    await loadProducts(campaignId);
  }

  async function createCampaign(name: string): Promise<Campaign | null> {
    setBusy("campaigns");
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Create campaign failed");
      setCampaigns(data.campaigns ?? []);
      const campaign = (data.campaigns ?? []).find((item: Campaign) => item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()) ?? null;
      showNotice("Campaign created", "success");
      return campaign;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Create campaign failed", "error");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function renameCampaign(campaignId: string, name: string) {
    setBusy("campaigns");
    try {
      const response = await fetch("/api/campaigns", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, name })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Rename campaign failed");
      setCampaigns(data.campaigns ?? []);
      showNotice("Campaign renamed", "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Rename campaign failed", "error");
    }
    setBusy(null);
  }

  async function deleteCampaign(campaignId: string) {
    setBusy("campaigns");
    try {
      const response = await fetch("/api/campaigns", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Delete campaign failed");
      setCampaigns(data.campaigns ?? []);
      const nextCampaignId = selectedCampaignId === campaignId ? "" : selectedCampaignId;
      setSelectedCampaignId(nextCampaignId);
      await loadProducts(nextCampaignId);
      showNotice("Campaign deleted", "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Delete campaign failed", "error");
    }
    setBusy(null);
  }

  async function ingestSource() {
    setBusy("source");
    showNotice("Extracting terminology from URL...");
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localizedUrls, syncLocalizedSources, url: sourceUrl })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Source extraction failed");
      setExtractedTerms(data.terms ?? []);
      showNotice(data.notice ?? `Generated ${data.terms?.length ?? 0} translations`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Source extraction failed", "error");
    }
    setBusy(null);
  }

  async function ingestFile() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      showNotice("Choose a PDF or Word file first", "error");
      return;
    }

    setBusy("file");
    showNotice(`Extracting terminology from ${file.name}...`);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/sources", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Document extraction failed");
      setExtractedTerms(data.terms ?? []);
      showNotice(data.notice ?? `Generated ${data.terms?.length ?? 0} translations`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Document extraction failed", "error");
    }
    setBusy(null);
  }

  async function saveTerms(tag?: string) {
    setBusy("save");
    showNotice("Saving translations to Library...");
    const normalizedTag = normalizeTagInput(tag);
    const matchingExistingTag = availableTags.find((candidate) => candidate.toLocaleLowerCase() === normalizedTag.toLocaleLowerCase());
    const tagToApply = matchingExistingTag ?? normalizedTag;
    const termsToSave = tagToApply
      ? extractedTerms.map((term) => ({
          ...term,
          tags: [...new Set([...(term.tags ?? []), tagToApply])],
          updatedAt: new Date().toISOString()
        }))
      : extractedTerms;
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms: termsToSave })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      setExtractedTerms([]);
      setSaveTagDialogOpen(false);
      setActivePage("library");
      showNotice(`Saved ${data.savedCount ?? 0} translations to Library`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Save failed", "error");
    }
    setBusy(null);
  }

  async function updateLibraryTerm(term: Term) {
    setBusy(`update-${term.id}`);
    showNotice("Updating Library translation...");
    try {
      const response = await fetch("/api/library", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          termId: term.id,
          canonical: term.canonical,
          folderId: term.folderId,
          translations: term.translations,
          type: term.type
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Update failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      showNotice("Library translation updated", "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Update failed", "error");
    }
    setBusy(null);
  }

  async function addLibraryTerm(term: Term) {
    setBusy("add-translation");
    showNotice("Adding translation to Library...");
    try {
      const response = await fetch("/api/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms: [term] })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Add translation failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      showNotice("Translation added to Library", "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Add translation failed", "error");
    }
    setBusy(null);
  }

  async function deleteLibraryTerm(termId: string) {
    return deleteLibraryTerms([termId]);
  }

  async function deleteLibraryTerms(termIds: string[]) {
    if (termIds.length === 0) return;
    setBusy(termIds.length === 1 ? `delete-${termIds[0]}` : "delete-selected");
    showNotice(termIds.length === 1 ? "Deleting Library translation..." : `Deleting ${termIds.length} Library translations...`);
    try {
      const response = await fetch("/api/library", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termIds })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Delete failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      showNotice(termIds.length === 1 ? "Library translation deleted" : `${termIds.length} Library translations deleted`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Delete failed", "error");
    }
    setBusy(null);
  }

  async function updateLibraryTags(body: Record<string, unknown>, notice: string) {
    setBusy("tags");
    showNotice("Updating Library tags...");
    try {
      const response = await fetch("/api/library", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Tag update failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      showNotice(notice, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Tag update failed", "error");
    }
    setBusy(null);
  }

  function applyTagToTerms(termIds: string[], tag: string) {
    return updateLibraryTags({ action: "applyTag", tag, termIds }, "Tag applied");
  }

  function renameLibraryTag(previousTag: string, nextTag: string) {
    return updateLibraryTags({ action: "renameTag", nextTag, previousTag }, "Tag renamed");
  }

  function deleteLibraryTag(tag: string) {
    return updateLibraryTags({ action: "deleteTag", tag }, "Tag deleted");
  }

  async function setLibraryTermReferenceEnabled(termId: string, enabled: boolean) {
    setBusy(`reference-${termId}`);
    showNotice(enabled ? "Enabling AI reference..." : "Disabling AI reference...");
    try {
      const response = await fetch("/api/library", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "setReferenceEnabled", enabled, termId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reference update failed");
      if (data.sync) setCloudSync(data.sync);
      setSavedTerms(data.terms ?? []);
      showNotice(enabled ? "AI reference enabled" : "AI reference disabled", "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Reference update failed", "error");
    }
    setBusy(null);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="brand">EU Figma Translation</div>
        </div>
        <ApiConnectionSignals figma={apiConnections.figma} openai={apiConnections.openai} />
      </header>

      <section className="app-layout">
        <nav className="menu panel">
          <button className={`menu-item ${activePage === "home" ? "active" : ""}`} onClick={() => setActivePage("home")} type="button">
            Home
          </button>
          <button className={`menu-item ${activePage === "library" ? "active" : ""}`} onClick={() => setActivePage("library")} type="button">
            Library
          </button>
          <button className={`menu-item ${activePage === "products" ? "active" : ""}`} onClick={() => setActivePage("products")} type="button">
            Products
          </button>
          <button className={`menu-item ${activePage === "setting" ? "active" : ""}`} onClick={() => setActivePage("setting")} type="button">
            Setting
          </button>
        </nav>

        {activePage === "home" ? (
          <HomePage
            busy={busy}
            cancelGeneratedTranslation={cancelGeneratedTranslation}
            extractedTerms={extractedTerms}
            ingestFile={ingestFile}
            ingestSource={ingestSource}
            saveTerms={() => setSaveTagDialogOpen(true)}
            setLocalizedUrls={setLocalizedUrls}
            setSourceUrl={setSourceUrl}
            setSyncLocalizedSources={setSyncLocalizedSources}
            sourceUrl={sourceUrl}
            localizedUrls={localizedUrls}
            fileInputRef={fileInputRef}
            syncLocalizedSources={syncLocalizedSources}
          />
        ) : activePage === "library" ? (
          <LibraryPanel
            busy={busy}
            cloudSync={cloudSync}
            onAddTerm={addLibraryTerm}
            onApplyTag={applyTagToTerms}
            onDeleteTerm={deleteLibraryTerm}
            onDeleteTerms={deleteLibraryTerms}
            onDeleteTag={deleteLibraryTag}
            onRenameTag={renameLibraryTag}
            onSetReferenceEnabled={setLibraryTermReferenceEnabled}
            onSyncNow={syncLibraryNow}
            onUpdateTerm={updateLibraryTerm}
            terms={savedTerms}
          />
        ) : activePage === "products" ? (
          <ProductsPanel
            busy={busy}
            campaigns={campaigns}
            cloudSync={cloudSync}
            onAddProduct={addProduct}
            onCreateCampaign={createCampaign}
            onDeleteProduct={deleteProduct}
            onDeleteCampaign={deleteCampaign}
            onRenameCampaign={renameCampaign}
            onSelectCampaign={selectCampaign}
            onSyncNow={syncProductsNow}
            onUpdateProduct={updateProduct}
            onUploadProducts={uploadProducts}
            products={products}
            selectedCampaignId={selectedCampaignId}
          />
        ) : (
          <SettingPanel onConnectionsChanged={refreshApiConnections} onNotice={showNotice} />
        )}
      </section>
      <FloatingNotice
        busy={busy}
        isGenerating={isGenerating}
        message={status}
        progress={generationProgress}
        tone={noticeTone}
      />
      {saveTagDialogOpen ? (
        <SaveTagDialog
          availableTags={availableTags}
          busy={busy === "save"}
          generatedCount={extractedTerms.length}
          onCancel={() => setSaveTagDialogOpen(false)}
          onSave={saveTerms}
        />
      ) : null}
      {syncConflicts.length > 0 ? (
        <SyncConflictDialog
          busy={busy === "cloud-sync-resolve"}
          conflicts={syncConflicts}
          onCancel={() => setSyncConflicts([])}
          onResolve={resolveSyncConflicts}
        />
      ) : null}
      {productSyncConflicts.length > 0 ? (
        <ProductSyncConflictDialog
          busy={busy === "products-cloud-sync-resolve"}
          conflicts={productSyncConflicts}
          onCancel={() => setProductSyncConflicts([])}
          onResolve={resolveProductSyncConflicts}
        />
      ) : null}
    </main>
  );
}

function normalizeTagInput(value?: string): string {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
}

async function loadApiConnection(url: string): Promise<ApiConnectionStatus> {
  try {
    const response = await fetch(url);
    const data = await readJsonResponse(response, "Settings");
    if (!response.ok) throw new Error(data.error || "Connection check failed");
    return {
      checking: false,
      configured: Boolean(data.configured),
      connected: Boolean(data.connected),
      error: data.error ? String(data.error) : undefined,
      source: data.source === "runtime" || data.source === "env" ? data.source : "none"
    };
  } catch (error) {
    return {
      checking: false,
      configured: true,
      connected: false,
      error: error instanceof Error ? error.message : "Connection check failed",
      source: "none"
    };
  }
}

function ApiConnectionSignals({ figma, openai }: { figma: ApiConnectionStatus; openai: ApiConnectionStatus }) {
  return (
    <div className="api-signals" aria-label="API connection status">
      <ApiConnectionSignal label="OpenAI" status={openai} />
      <ApiConnectionSignal label="Figma" status={figma} />
    </div>
  );
}

function ApiConnectionSignal({ label, status }: { label: string; status: ApiConnectionStatus }) {
  const state = status.checking ? "checking" : status.connected ? "connected" : status.configured ? "failed" : "missing";
  const message = status.checking
    ? `${label} checking`
    : status.connected
      ? `${label} connected`
      : status.configured
        ? `${label} not connected${status.error ? `: ${status.error}` : ""}`
        : `${label} not configured`;

  return (
    <div className="api-signal" title={message}>
      <span className={`signal-dot ${state}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function HomePage({
  busy,
  cancelGeneratedTranslation,
  extractedTerms,
  ingestFile,
  ingestSource,
  saveTerms,
  setLocalizedUrls,
  setSourceUrl,
  setSyncLocalizedSources,
  sourceUrl,
  localizedUrls,
  fileInputRef,
  syncLocalizedSources
}: {
  busy: string | null;
  cancelGeneratedTranslation: () => void;
  extractedTerms: Term[];
  ingestFile: () => void;
  ingestSource: () => void;
  saveTerms: () => void;
  setLocalizedUrls: (value: Record<Locale, string>) => void;
  setSourceUrl: (value: string) => void;
  setSyncLocalizedSources: (value: boolean) => void;
  sourceUrl: string;
  localizedUrls: Record<Locale, string>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  syncLocalizedSources: boolean;
}) {
  const [sourceTab, setSourceTab] = useState<"url" | "file">("url");
  const hasGeneratedTranslation = extractedTerms.length > 0;

  function cancelAndReset() {
    cancelGeneratedTranslation();
    setSourceTab("url");
  }

  return (
    <section className="content">
      <aside className="stack">
        <div className="panel stack source-panel">
          <h2>Import Source to Library</h2>
          <div className="source-tabs" role="tablist" aria-label="Source input type">
            <button
              aria-selected={sourceTab === "url"}
              className={`source-tab ${sourceTab === "url" ? "active" : ""}`}
              onClick={() => setSourceTab("url")}
              role="tab"
              type="button"
            >
              URL
            </button>
            <button
              aria-selected={sourceTab === "file"}
              className={`source-tab ${sourceTab === "file" ? "active" : ""}`}
              onClick={() => setSourceTab("file")}
              role="tab"
              type="button"
            >
              PDF / Word
            </button>
          </div>

          {sourceTab === "url" ? (
            <>
              <label className="field">
                <span>Product website URL</span>
                <input
                  className="input"
                  placeholder="https://de.eureka.com/products/eureka-j15-max-ultra"
                  suppressHydrationWarning
                  value={sourceUrl ?? ""}
                  onChange={(event) => setSourceUrl(event.target.value)}
                />
              </label>
              <div className="check-field">
                <label className="check-row">
                  <input
                    checked={syncLocalizedSources}
                    onChange={(event) => setSyncLocalizedSources(event.target.checked)}
                    suppressHydrationWarning
                    type="checkbox"
                  />
                  <span>Sync across Multilingual Sources</span>
                </label>
                <p>AI will cross-reference terms from all provided regional URLs to build a unified translation table.</p>
              </div>
              {syncLocalizedSources ? (
                <div className="locale-url-grid">
                  {locales.map((locale) => (
                    <label className="field" key={locale}>
                      <span>{locale} URL</span>
                      <input
                        className="input"
                        placeholder={`https://example.com/${locale.toLocaleLowerCase()}/product`}
                        suppressHydrationWarning
                        value={localizedUrls[locale] ?? ""}
                        onChange={(event) =>
                          setLocalizedUrls({
                            ...localizedUrls,
                            [locale]: event.target.value
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="field">
                <span>PDF / Word file</span>
                <input
                  className="input"
                  ref={fileInputRef}
                  suppressHydrationWarning
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                />
              </label>
            </>
          )}
          <div className="home-action-row">
            {hasGeneratedTranslation ? (
              <>
                <button className="button" disabled={busy === "save"} onClick={saveTerms} type="button">
                  {busy === "save" ? "Saving..." : "Save to Library"}
                </button>
                <button className="button secondary" disabled={Boolean(busy)} onClick={cancelAndReset} type="button">
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="button"
                disabled={busy === "source" || busy === "file"}
                onClick={sourceTab === "url" ? ingestSource : ingestFile}
                type="button"
              >
                {sourceTab === "url"
                  ? busy === "source"
                    ? "Extracting..."
                    : "Generate Translation"
                  : busy === "file"
                    ? "Uploading..."
                    : "Generate Translation"}
              </button>
            )}
          </div>
        </div>
      </aside>

      {hasGeneratedTranslation ? (
        <section className="stack">
          <LibraryPanel emptyText="Generated translation will appear here before saving." title="Generated Translation" terms={extractedTerms} />
        </section>
      ) : null}
    </section>
  );
}

function FloatingNotice({
  busy,
  isGenerating,
  message,
  progress,
  tone
}: {
  busy: string | null;
  isGenerating: boolean;
  message: string;
  progress: number;
  tone: NoticeTone;
}) {
  if (message === "Home ready") return null;

  return (
    <div className={`floating-notice ${tone}`} aria-live={tone === "error" ? "assertive" : "polite"}>
      <div className="floating-notice-meta">
        <span>{message}</span>
        {isGenerating ? <span>{progress}%</span> : null}
      </div>
      {isGenerating ? (
        <div className="floating-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="floating-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {!isGenerating && busy ? <div className="floating-notice-subtle">Working...</div> : null}
    </div>
  );
}

function SaveTagDialog({
  availableTags,
  busy,
  generatedCount,
  onCancel,
  onSave
}: {
  availableTags: string[];
  busy: boolean;
  generatedCount: number;
  onCancel: () => void;
  onSave: (tag?: string) => void;
}) {
  const [tagDraft, setTagDraft] = useState("");
  const normalizedTag = normalizeTagInput(tagDraft);
  const matchingExistingTag = availableTags.find((tag) => tag.toLocaleLowerCase() === normalizedTag.toLocaleLowerCase());

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack" role="dialog" aria-modal="true" aria-labelledby="save-tag-title">
        <div>
          <h2 id="save-tag-title">Save to Library</h2>
          <p className="modal-copy">{generatedCount} generated translations will be saved to Library.</p>
        </div>
        <label className="field">
          <span>Optional tag</span>
          <input
            autoFocus
            className="input"
            list="home-save-existing-tags"
            onChange={(event) => setTagDraft(event.target.value)}
            placeholder="Add or select tag"
            suppressHydrationWarning
            value={tagDraft}
          />
          <datalist id="home-save-existing-tags">
            {availableTags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </label>
        {normalizedTag ? <span className="badge">{matchingExistingTag ? "Existing tag" : "New tag"}</span> : null}
        <div className="modal-actions">
          <button className="button" disabled={busy || !normalizedTag} onClick={() => onSave(normalizedTag)} type="button">
            {busy ? "Saving..." : "Save with Tag"}
          </button>
          <button className="button secondary" disabled={busy} onClick={() => onSave()} type="button">
            Save without Tag
          </button>
          <button className="button secondary" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function SyncConflictDialog({
  busy,
  conflicts,
  onCancel,
  onResolve
}: {
  busy: boolean;
  conflicts: SyncConflict[];
  onCancel: () => void;
  onResolve: (resolutions: Array<{ action: "overwrite" | "skip"; termId: string }>) => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, "overwrite" | "skip">>(
    Object.fromEntries(conflicts.map((conflict) => [conflict.termId, "skip"]))
  );

  useEffect(() => {
    setResolutions(Object.fromEntries(conflicts.map((conflict) => [conflict.termId, "skip"])));
  }, [conflicts]);

  function submit() {
    onResolve(conflicts.map((conflict) => ({ action: resolutions[conflict.termId] ?? "skip", termId: conflict.termId })));
  }

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack sync-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title">
        <div>
          <h2 id="sync-conflict-title">Sync Conflicts</h2>
          <p className="modal-copy">Supabase has newer changes for these Library entities. Choose what to do for each entity.</p>
        </div>
        <div className="sync-conflict-list">
          {conflicts.map((conflict) => (
            <div className="sync-conflict-item" key={`${conflict.type}-${conflict.termId}`}>
              <div className="sync-conflict-copy">
                <strong>{conflict.localTerm?.canonical || conflict.cloudTerm?.canonical || conflict.termId}</strong>
                <span className="badge">{conflict.type === "delete" ? "Local delete conflict" : "Edit conflict"}</span>
              </div>
              <div className="sync-conflict-compare">
                <div>
                  <span className="muted-text">Your local</span>
                  <p>{conflict.localTerm?.canonical ?? "Deleted locally"}</p>
                </div>
                <div>
                  <span className="muted-text">Supabase</span>
                  <p>{conflict.cloudTerm?.canonical ?? "Deleted in cloud"}</p>
                </div>
              </div>
              <div className="sync-conflict-actions">
                <label>
                  <input
                    checked={(resolutions[conflict.termId] ?? "skip") === "overwrite"}
                    disabled={busy}
                    name={`sync-conflict-${conflict.termId}`}
                    onChange={() => setResolutions((current) => ({ ...current, [conflict.termId]: "overwrite" }))}
                    type="radio"
                  />
                  Overwrite
                </label>
                <label>
                  <input
                    checked={(resolutions[conflict.termId] ?? "skip") === "skip"}
                    disabled={busy}
                    name={`sync-conflict-${conflict.termId}`}
                    onChange={() => setResolutions((current) => ({ ...current, [conflict.termId]: "skip" }))}
                    type="radio"
                  />
                  Skip
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button" disabled={busy} onClick={submit} type="button">
            {busy ? "Applying..." : "Apply Choices"}
          </button>
          <button className="button secondary" disabled={busy} onClick={onCancel} type="button">
            Cancel Sync
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingPanel({
  onConnectionsChanged,
  onNotice
}: {
  onConnectionsChanged: () => void;
  onNotice: (message: string, tone?: NoticeTone) => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [figmaToken, setFigmaToken] = useState("");
  const [model, setModel] = useState("gpt-5.5");
  const [supabaseServiceRoleKey, setSupabaseServiceRoleKey] = useState("");
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [showFigmaToken, setShowFigmaToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [status, setStatus] = useState<{
    baseUrl?: string;
    configured: boolean;
    maskedKey?: string;
    model?: string;
    source: "runtime" | "env" | "none";
  }>({
    configured: false,
    model: "gpt-5.5",
    source: "none"
  });
  const [figmaStatus, setFigmaStatus] = useState<{
    configured: boolean;
    maskedToken?: string;
    source: "runtime" | "env" | "none";
  }>({
    configured: false,
    source: "none"
  });
  const [supabaseStatus, setSupabaseStatus] = useState<{
    configured: boolean;
    maskedKey?: string;
    source: "runtime" | "env" | "none";
    syncEnabled: boolean;
    url?: string;
  }>({
    configured: false,
    source: "none",
    syncEnabled: false
  });
  const [message, setMessage] = useState("Loading settings...");
  const [figmaMessage, setFigmaMessage] = useState("Loading Figma settings...");
  const [supabaseMessage, setSupabaseMessage] = useState("Loading Supabase settings...");

  useEffect(() => {
    void loadStatus();
    void loadFigmaStatus();
    void loadSupabaseStatus();
  }, []);

  async function loadStatus() {
    try {
      const response = await fetch("/api/settings/openai");
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Load failed");
      setStatus(data);
      setApiKey(data.maskedKey || "");
      setBaseUrl(data.baseUrl || "https://api.openai.com/v1");
      setModel(data.model || "gpt-5.5");
      setMessage(settingMessage(data));
    } catch {
      const message = "Cannot reach the local settings API. Check that the dev server is running.";
      setMessage(message);
      onNotice(message, "error");
    }
  }

  async function loadFigmaStatus() {
    try {
      const response = await fetch("/api/settings/figma");
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Load failed");
      setFigmaStatus(data);
      setFigmaToken(data.maskedToken || "");
      setFigmaMessage(figmaSettingMessage(data));
    } catch {
      const message = "Cannot reach the local Figma settings API. Check that the dev server is running.";
      setFigmaMessage(message);
      onNotice(message, "error");
    }
  }

  async function loadSupabaseStatus() {
    try {
      const response = await fetch("/api/settings/supabase");
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Load failed");
      setSupabaseStatus(data);
      setSupabaseUrl(data.url || "");
      setSupabaseServiceRoleKey(data.maskedKey || "");
      setSupabaseMessage(supabaseSettingMessage(data));
    } catch {
      const message = "Cannot reach the local Supabase settings API. Check that the dev server is running.";
      setSupabaseMessage(message);
      onNotice(message, "error");
    }
  }

  async function saveKey() {
    setBusy("save");
    try {
      const response = await fetch("/api/settings/openai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiKey, baseUrl, model })
      });
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Save failed");
      setApiKey(data.maskedKey || "");
      setShowApiKey(false);
      setStatus(data);
      setMessage(settingMessage(data));
      onNotice("OpenAI settings saved", "success");
      onConnectionsChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Save failed. Check that the dev server is running.";
      setMessage(message);
      onNotice(message, "error");
    }
    setBusy(null);
  }

  async function clearKey() {
    setBusy("clear");
    try {
      const response = await fetch("/api/settings/openai", { method: "DELETE" });
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Clear failed");
      setStatus(data);
      setApiKey(data.maskedKey || "");
      setModel(data.model || "gpt-5.5");
      setMessage(settingMessage(data));
      onNotice("OpenAI runtime key cleared", "success");
      onConnectionsChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot reach the local settings API. Check that the dev server is running.";
      setMessage(message);
      onNotice(message, "error");
    }
    setBusy(null);
  }

  async function saveFigmaToken() {
    setBusy("figma-save");
    try {
      const response = await fetch("/api/settings/figma", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: figmaToken })
      });
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Save failed");
      setFigmaToken(data.maskedToken || "");
      setShowFigmaToken(false);
      setFigmaStatus(data);
      setFigmaMessage(figmaSettingMessage(data));
      onNotice("Figma settings saved", "success");
      onConnectionsChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Figma save failed. Check that the dev server is running.";
      setFigmaMessage(message);
      onNotice(message, "error");
    }
    setBusy(null);
  }

  async function clearFigmaToken() {
    setBusy("figma-clear");
    try {
      const response = await fetch("/api/settings/figma", { method: "DELETE" });
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Clear failed");
      setFigmaStatus(data);
      setFigmaToken(data.maskedToken || "");
      setFigmaMessage(figmaSettingMessage(data));
      onNotice("Figma runtime token cleared", "success");
      onConnectionsChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot reach the local Figma settings API. Check that the dev server is running.";
      setFigmaMessage(message);
      onNotice(message, "error");
    }
    setBusy(null);
  }

  async function saveSupabaseSettings() {
    setBusy("supabase-save");
    try {
      const response = await fetch("/api/settings/supabase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceRoleKey: supabaseServiceRoleKey, url: supabaseUrl })
      });
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Save failed");
      setSupabaseUrl(data.url || "");
      setSupabaseServiceRoleKey(data.maskedKey || "");
      setShowSupabaseKey(false);
      setSupabaseStatus(data);
      setSupabaseMessage(supabaseSettingMessage(data));
      onNotice("Supabase settings saved", "success");
      onConnectionsChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Supabase save failed. Check that the dev server is running.";
      setSupabaseMessage(message);
      onNotice(message, "error");
    }
    setBusy(null);
  }

  async function clearSupabaseSettings() {
    setBusy("supabase-clear");
    try {
      const response = await fetch("/api/settings/supabase", { method: "DELETE" });
      const data = await readSettingsResponse(response);
      if (!response.ok) throw new Error(data.error || "Clear failed");
      setSupabaseStatus(data);
      setSupabaseUrl(data.url || "");
      setSupabaseServiceRoleKey(data.maskedKey || "");
      setSupabaseMessage(supabaseSettingMessage(data));
      onNotice("Supabase runtime settings cleared", "success");
      onConnectionsChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cannot reach the local Supabase settings API. Check that the dev server is running.";
      setSupabaseMessage(message);
      onNotice(message, "error");
    }
    setBusy(null);
  }

  return (
    <section className="settings-layout">
      <div className="panel stack">
        <h2>Setting</h2>
        <label className="field">
          <span>OpenAI API Key</span>
          <div className="secret-field">
            <input
              className="input"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Enter API key"
              suppressHydrationWarning
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onFocus={() => {
                if (!showApiKey && status.maskedKey && apiKey === status.maskedKey) setApiKey("");
              }}
            />
            <button className="icon-button" onClick={() => setShowApiKey(!showApiKey)} type="button">
              {showApiKey ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        <label className="field">
          <span>OpenAI API URL</span>
          <input
            className="input"
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
            suppressHydrationWarning
            value={baseUrl}
          />
        </label>
        <label className="field">
          <span>OpenAI Model</span>
          <input className="input" onChange={(event) => setModel(event.target.value)} placeholder="gpt-5.5" suppressHydrationWarning value={model} />
        </label>
        <div className="button-row">
          <button className="button" disabled={busy === "save" || !apiKey.trim()} onClick={saveKey} type="button">
            {busy === "save" ? "Saving..." : "Save"}
          </button>
          <button className="button secondary" disabled={busy === "clear" || status.source !== "runtime"} onClick={clearKey} type="button">
            {busy === "clear" ? "Clearing..." : "Clear"}
          </button>
        </div>
        <div className="status-line">{message}</div>
        <h2>Figma</h2>
        <label className="field">
          <span>Figma Access Token</span>
          <div className="secret-field">
            <input
              className="input"
              onChange={(event) => setFigmaToken(event.target.value)}
              placeholder="Enter Figma access token"
              suppressHydrationWarning
              type={showFigmaToken ? "text" : "password"}
              value={figmaToken}
              onFocus={() => {
                if (!showFigmaToken && figmaStatus.maskedToken && figmaToken === figmaStatus.maskedToken) setFigmaToken("");
              }}
            />
            <button className="icon-button" onClick={() => setShowFigmaToken(!showFigmaToken)} type="button">
              {showFigmaToken ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        <div className="button-row">
          <button className="button" disabled={busy === "figma-save" || !figmaToken.trim()} onClick={saveFigmaToken} type="button">
            {busy === "figma-save" ? "Saving..." : "Save Figma Token"}
          </button>
          <button className="button secondary" disabled={busy === "figma-clear" || figmaStatus.source !== "runtime"} onClick={clearFigmaToken} type="button">
            {busy === "figma-clear" ? "Clearing..." : "Clear"}
          </button>
        </div>
        <div className="status-line">{figmaMessage}</div>
        <h2>Supabase</h2>
        <label className="field">
          <span>Supabase URL</span>
          <input
            className="input"
            onChange={(event) => setSupabaseUrl(event.target.value)}
            placeholder="https://your-project-ref.supabase.co"
            suppressHydrationWarning
            value={supabaseUrl}
          />
        </label>
        <label className="field">
          <span>Service Role Key</span>
          <div className="secret-field">
            <input
              className="input"
              onChange={(event) => setSupabaseServiceRoleKey(event.target.value)}
              placeholder="Enter Supabase service role key"
              suppressHydrationWarning
              type={showSupabaseKey ? "text" : "password"}
              value={supabaseServiceRoleKey}
              onFocus={() => {
                if (!showSupabaseKey && supabaseStatus.maskedKey && supabaseServiceRoleKey === supabaseStatus.maskedKey) setSupabaseServiceRoleKey("");
              }}
            />
            <button className="icon-button" onClick={() => setShowSupabaseKey(!showSupabaseKey)} type="button">
              {showSupabaseKey ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        <div className="button-row">
          <button className="button" disabled={busy === "supabase-save" || !supabaseUrl.trim() || !supabaseServiceRoleKey.trim()} onClick={saveSupabaseSettings} type="button">
            {busy === "supabase-save" ? "Saving..." : "Save Supabase"}
          </button>
          <button className="button secondary" disabled={busy === "supabase-clear" || supabaseStatus.source !== "runtime"} onClick={clearSupabaseSettings} type="button">
            {busy === "supabase-clear" ? "Clearing..." : "Clear"}
          </button>
        </div>
        <div className="status-line">{supabaseMessage}</div>
      </div>
    </section>
  );
}

async function readSettingsResponse(response: Response) {
  return readJsonResponse(response, "Settings");
}

async function readJsonResponse(response: Response, label: string) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return response.json();

  const text = await response.text();
  const fallback = text.trim().startsWith("<")
    ? `${label} API returned an HTML page instead of JSON. Check the dev server route and try again.`
    : text.trim();
  throw new Error(fallback || `${label} API failed with status ${response.status}`);
}

function settingMessage(status: {
  baseUrl?: string;
  configured: boolean;
  maskedKey?: string;
  model?: string;
  source: "runtime" | "env" | "none";
}): string {
  if (!status.configured) return "No OpenAI API key configured.";
  if (status.source === "runtime") {
    return `Runtime key verified and configured: ${status.maskedKey}. API URL: ${status.baseUrl}. Model: ${status.model}`;
  }
  return `Environment key configured: ${status.maskedKey}. API URL: ${status.baseUrl}. Model: ${status.model}`;
}

function figmaSettingMessage(status: { configured: boolean; maskedToken?: string; source: "runtime" | "env" | "none" }): string {
  if (!status.configured) return "No Figma access token configured.";
  if (status.source === "runtime") return `Runtime Figma token verified and configured: ${status.maskedToken}.`;
  return `Environment Figma token configured: ${status.maskedToken}.`;
}

function supabaseSettingMessage(status: {
  configured: boolean;
  maskedKey?: string;
  source: "runtime" | "env" | "none";
  syncEnabled: boolean;
  url?: string;
}): string {
  if (!status.configured) return "No Supabase cloud sync configured.";
  const source = status.source === "runtime" ? "Runtime" : "Environment";
  const syncState = status.syncEnabled ? "Cloud sync enabled" : "Cloud sync disabled";
  return `${source} Supabase configured: ${status.maskedKey}. URL: ${status.url}. ${syncState}.`;
}

function LibraryPanel({
  busy,
  cloudSync,
  emptyText = "No saved translation yet. Use Home to generate translation, then click Save.",
  onAddTerm,
  onApplyTag,
  onDeleteTerm,
  onDeleteTerms,
  onDeleteTag,
  onRenameTag,
  onSetReferenceEnabled,
  onSyncNow,
  onUpdateTerm,
  terms,
  title = "Library"
}: {
  busy?: string | null;
  cloudSync?: CloudSyncStatus;
  emptyText?: string;
  onAddTerm?: (term: Term) => void;
  onApplyTag?: (termIds: string[], tag: string) => void;
  onDeleteTerm?: (termId: string) => void;
  onDeleteTerms?: (termIds: string[]) => void;
  onDeleteTag?: (tag: string) => void;
  onRenameTag?: (previousTag: string, nextTag: string) => void;
  onSetReferenceEnabled?: (termId: string, enabled: boolean) => void;
  onSyncNow?: () => void;
  onUpdateTerm?: (term: Term) => void;
  terms: Term[];
  title?: string;
}) {
  const editable = Boolean(onDeleteTerm || onUpdateTerm);
  const [addTranslationOpen, setAddTranslationOpen] = useState(false);
  const [cloneSourceTerm, setCloneSourceTerm] = useState<Term | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [selectedTermIds, setSelectedTermIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Term | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [tagRenameDraft, setTagRenameDraft] = useState("");
  const [bulkActionMode, setBulkActionMode] = useState<"default" | "applyTag">("default");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"all" | "tag">("all");
  const [activeFolderId, setActiveFolderId] = useState<Term["folderId"]>("product_names");
  const [currentPageByFolder, setCurrentPageByFolder] = useState<Partial<Record<Term["folderId"], number>>>({});
  const filteredTerms = editable ? terms.filter((term) => matchesTermSearch(term, searchQuery, searchMode)) : terms;
  const showEvidenceColumn = !editable;
  const libraryColumnCount = (editable ? 1 : 0) + 2 + (editable ? 1 : 0) + locales.length + (showEvidenceColumn ? 1 : 0) + (editable ? 2 : 0);
  const editPanelColSpan = Math.max(1, libraryColumnCount - 1);
  const availableTags = [...new Set(terms.flatMap((term) => term.tags ?? []))].sort((a, b) => a.localeCompare(b));
  const matchingExistingTag = availableTags.find((tag) => tag.toLocaleLowerCase() === tagDraft.trim().toLocaleLowerCase());
  const activeFolder = libraryFolders.find((folder) => folder.id === activeFolderId) ?? libraryFolders[0];
  const activeFolderTerms = filteredTerms.filter((term) => term.folderId === activeFolder.id);
  const activePage = currentPageByFolder[activeFolder.id] ?? 1;
  const pageCount = Math.max(1, Math.ceil(activeFolderTerms.length / LIBRARY_PAGE_SIZE));
  const clampedActivePage = Math.min(activePage, pageCount);
  const pageStartIndex = (clampedActivePage - 1) * LIBRARY_PAGE_SIZE;
  const paginatedTerms = activeFolderTerms.slice(pageStartIndex, pageStartIndex + LIBRARY_PAGE_SIZE);
  const paginatedTermIds = paginatedTerms.map((term) => term.id);
  const allPageSelected = paginatedTermIds.length > 0 && paginatedTermIds.every((termId) => selectedTermIds.includes(termId));
  const pageRangeStart = activeFolderTerms.length === 0 ? 0 : pageStartIndex + 1;
  const pageRangeEnd = Math.min(pageStartIndex + paginatedTerms.length, activeFolderTerms.length);

  useEffect(() => {
    setSelectedTermIds((current) => current.filter((termId) => terms.some((term) => term.id === termId)));
  }, [terms]);

  useEffect(() => {
    if (selectedTermIds.length > 0) return;
    setBulkActionMode("default");
    setTagDraft("");
  }, [selectedTermIds.length]);

  useEffect(() => {
    const activeFolderTotal = terms.filter((term) => term.folderId === activeFolderId).length;
    if (terms.length === 0 || activeFolderTotal > 0) return;
    const firstFolderWithTerms = libraryFolders.find((folder) => terms.some((term) => term.folderId === folder.id));
    setActiveFolderId((firstFolderWithTerms?.id ?? "product_names") as Term["folderId"]);
  }, [activeFolderId, terms]);

  useEffect(() => {
    if (activePage <= pageCount) return;
    setCurrentPageByFolder((current) => ({ ...current, [activeFolder.id]: pageCount }));
  }, [activeFolder.id, activePage, pageCount]);

  function startEdit(term: Term) {
    setEditingId(term.id);
    setDraft({
      ...term,
      translations: { ...term.translations }
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function saveEdit() {
    if (!draft || !onUpdateTerm) return;
    onUpdateTerm(draft);
    cancelEdit();
  }

  function startClone(term: Term) {
    setCloneSourceTerm(term);
    setAddTranslationOpen(true);
  }

  function closeAddTranslationDialog() {
    setAddTranslationOpen(false);
    setCloneSourceTerm(null);
  }

  function toggleTermSelection(termId: string) {
    setSelectedTermIds((current) =>
      current.includes(termId) ? current.filter((candidate) => candidate !== termId) : [...current, termId]
    );
  }

  function togglePageSelection() {
    if (allPageSelected) {
      setSelectedTermIds((current) => current.filter((termId) => !paginatedTermIds.includes(termId)));
      return;
    }
    setSelectedTermIds((current) => [...new Set([...current, ...paginatedTermIds])]);
  }

  function changeFolderTab(folderId: Term["folderId"]) {
    setActiveFolderId(folderId);
    setSelectedTermIds([]);
    setBulkActionMode("default");
    setTagDraft("");
  }

  function setActiveFolderPage(page: number) {
    const nextPage = Math.min(Math.max(page, 1), pageCount);
    setCurrentPageByFolder((current) => ({ ...current, [activeFolder.id]: nextPage }));
  }

  function applyTag() {
    const tag = matchingExistingTag ?? tagDraft.trim();
    if (!tag || selectedTermIds.length === 0) return;
    onApplyTag?.(selectedTermIds, tag);
    setSelectedTermIds([]);
    setTagDraft("");
    setBulkActionMode("default");
  }

  function deleteSelectedTerms() {
    if (selectedTermIds.length === 0) return;
    onDeleteTerms?.(selectedTermIds);
    setSelectedTermIds([]);
    setBulkActionMode("default");
  }

  function cancelApplyTag() {
    setTagDraft("");
    setBulkActionMode("default");
  }

  function startTagEdit(tag: string) {
    setEditingTag(tag);
    setTagRenameDraft(tag);
  }

  function saveTagEdit() {
    const nextTag = tagRenameDraft.trim();
    if (!editingTag || !nextTag) return;
    onRenameTag?.(editingTag, nextTag);
    setEditingTag(null);
    setTagRenameDraft("");
  }

  function folderIdForType(type: Term["type"]): Term["folderId"] {
    return libraryFolders.find((folder) => (folder.termTypes as readonly string[]).includes(type))?.id ?? "features";
  }

  return (
    <div className="panel stack">
      <div className="panel-title-row">
        <h2>{title}</h2>
        {editable ? (
          <div className="library-header-actions">
            {cloudSync ? <CloudSyncBadge busy={busy === "cloud-sync"} onSyncNow={onSyncNow} sync={cloudSync} /> : null}
            <button className="button secondary" onClick={() => setAddTranslationOpen(true)} type="button">
              Add Translation
            </button>
            <button className="button secondary" onClick={() => setTagManagerOpen(true)} type="button">
              Manage Tag
            </button>
          </div>
        ) : null}
      </div>
      {terms.length === 0 ? (
        <p>{emptyText}</p>
      ) : (
        <>
          {editable ? (
            <>
              <div className="library-search-row">
                <select
                  aria-label="Search mode"
                  className="select search-mode-select"
                  onChange={(event) => setSearchMode(event.target.value as "all" | "tag")}
                  suppressHydrationWarning
                  value={searchMode}
                >
                  <option value="all">All</option>
                  <option value="tag">Tag</option>
                </select>
                <input
                  className="input"
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={searchMode === "tag" ? "Search tags" : "Search entity, tag, category, locale translation, or evidence"}
                  suppressHydrationWarning
                  type="search"
                  value={searchQuery}
                />
              </div>
              {selectedTermIds.length > 0 ? (
                <div className="bulk-action-row">
                  <span className="selection-count">{selectedTermIds.length} selected</span>
                  {bulkActionMode === "applyTag" ? (
                    <>
                      <input
                        className="input tag-input"
                        list="library-existing-tags"
                        onChange={(event) => setTagDraft(event.target.value)}
                        placeholder="Create or select tag"
                        suppressHydrationWarning
                        value={tagDraft}
                      />
                      <datalist id="library-existing-tags">
                        {availableTags.map((tag) => (
                          <option key={tag} value={tag} />
                        ))}
                      </datalist>
                      {tagDraft.trim() ? <span className="badge">{matchingExistingTag ? "Existing tag" : "New tag"}</span> : null}
                      <button className="button" disabled={busy === "tags" || !tagDraft.trim()} onClick={applyTag} type="button">
                        Apply
                      </button>
                      <button className="button secondary" disabled={busy === "tags"} onClick={cancelApplyTag} type="button">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="button" disabled={busy === "tags"} onClick={() => setBulkActionMode("applyTag")} type="button">
                        Apply Tag
                      </button>
                      <button className="button danger" disabled={busy === "delete-selected"} onClick={deleteSelectedTerms} type="button">
                        Delete Selected
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </>
          ) : null}
          <div className="library-tabs" role="tablist" aria-label="Library folders">
            {libraryFolders.map((folder) => {
              const folderCount = filteredTerms.filter((term) => term.folderId === folder.id).length;
              const isActive = activeFolder.id === folder.id;
              return (
                <button
                  aria-selected={isActive}
                  className={`library-tab ${isActive ? "active" : ""}`}
                  key={folder.id}
                  onClick={() => changeFolderTab(folder.id as Term["folderId"])}
                  role="tab"
                  type="button"
                >
                  <span>{folder.label}</span>
                  <span className="tab-count">{folderCount}</span>
                </button>
              );
            })}
          </div>
          {filteredTerms.length === 0 ? (
            <p>No translation matches your search.</p>
          ) : activeFolderTerms.length === 0 ? (
            <p>No translation matches this tab.</p>
          ) : (
            <section className="library-folder">
              <div className="folder-title">
                <h3>{activeFolder.label}</h3>
                <span className="badge">{activeFolderTerms.length} translations</span>
              </div>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      {editable ? (
                        <th className="select-column">
                          <input checked={allPageSelected} onChange={togglePageSelection} suppressHydrationWarning type="checkbox" />
                        </th>
                      ) : null}
                      <th>EN</th>
                      <th>Category</th>
                      {editable ? <th>Tags</th> : null}
                      {locales.map((locale) => (
                        <th key={locale}>{locale}</th>
                      ))}
                      {showEvidenceColumn ? <th>Evidence</th> : null}
                      {editable ? <th>AI</th> : null}
                      {editable ? <th>Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedTerms.map((term) => {
                      const isEditing = editingId === term.id && draft;
                      const referenceEnabled = term.status === "approved";
                      if (isEditing) {
                        return (
                          <tr className={`library-edit-row ${referenceEnabled ? "" : "disabled-reference-row"}`} key={term.id}>
                            {editable ? (
                              <td className="select-column">
                                <input checked={selectedTermIds.includes(term.id)} onChange={() => toggleTermSelection(term.id)} suppressHydrationWarning type="checkbox" />
                              </td>
                            ) : null}
                            <td colSpan={editPanelColSpan}>
                              <div className="table-edit-panel">
                                <div className="table-edit-primary">
                                  <label className="field">
                                    <span>EN</span>
                                    <textarea
                                      className="table-input table-edit-textarea"
                                      onChange={(event) => setDraft({ ...draft, canonical: event.target.value })}
                                      suppressHydrationWarning
                                      value={draft.canonical}
                                    />
                                  </label>
                                  <label className="field">
                                    <span>Category</span>
                                    <select
                                      className="table-input"
                                      onChange={(event) => {
                                        const nextType = event.target.value as Term["type"];
                                        setDraft({ ...draft, folderId: folderIdForType(nextType), type: nextType });
                                      }}
                                      suppressHydrationWarning
                                      value={draft.type}
                                    >
                                      {termTypes.map((type) => (
                                        <option key={type} value={type}>
                                          {type}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                                <div className="table-edit-translations">
                                  {locales.map((locale) => (
                                    <label className="field" key={locale}>
                                      <span>{locale}</span>
                                      <textarea
                                        className="table-input table-edit-textarea"
                                        onChange={(event) =>
                                          setDraft({
                                            ...draft,
                                            translations: {
                                              ...draft.translations,
                                              [locale]: event.target.value
                                            }
                                          })
                                        }
                                        suppressHydrationWarning
                                        value={draft.translations[locale as Locale] ?? ""}
                                      />
                                    </label>
                                  ))}
                                </div>
                                <div className="table-edit-actions">
                                  <button className="small-button table-action-button" disabled={busy === `update-${term.id}`} onClick={saveEdit} type="button">
                                    Save
                                  </button>
                                  <button className="small-button secondary table-action-button" onClick={cancelEdit} type="button">
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <tr className={referenceEnabled ? "" : "disabled-reference-row"} key={term.id}>
                          {editable ? (
                            <td className="select-column">
                              <input checked={selectedTermIds.includes(term.id)} onChange={() => toggleTermSelection(term.id)} suppressHydrationWarning type="checkbox" />
                            </td>
                          ) : null}
                          <td>
                            {isEditing ? (
                              <input
                                className="table-input"
                                onChange={(event) => setDraft({ ...draft, canonical: event.target.value })}
                                suppressHydrationWarning
                                value={draft.canonical}
                              />
                            ) : (
                              term.canonical
                            )}
                          </td>
                          <td>
                            {isEditing ? (
                              <select
                                className="table-input"
                                onChange={(event) => {
                                  const nextType = event.target.value as Term["type"];
                                  setDraft({ ...draft, folderId: folderIdForType(nextType), type: nextType });
                                }}
                                suppressHydrationWarning
                                value={draft.type}
                              >
                                {termTypes.map((type) => (
                                  <option key={type} value={type}>
                                    {type}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              term.type
                            )}
                          </td>
                          {editable ? (
                            <td>
                              <div className="term-tags">
                                {(term.tags ?? []).length > 0 ? (
                                  term.tags?.map((tag) => (
                                    <span className="tag-chip" key={tag}>
                                      {tag}
                                    </span>
                                  ))
                                ) : (
                                  <span className="muted-text">No tags</span>
                                )}
                              </div>
                            </td>
                          ) : null}
                          {locales.map((locale) => (
                            <td key={locale}>
                              {isEditing ? (
                                <input
                                  className="table-input"
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      translations: {
                                        ...draft.translations,
                                        [locale]: event.target.value
                                      }
                                    })
                                  }
                                  suppressHydrationWarning
                                  value={draft.translations[locale as Locale] ?? ""}
                                />
                              ) : (
                                term.translations[locale as Locale] ?? ""
                              )}
                            </td>
                          ))}
                          {showEvidenceColumn ? (
                            <td>
                              {term.evidence.map((evidence) => (
                                <div className="evidence-line" key={evidence.id}>
                                  {evidence.locale ? <strong>{evidence.locale}: </strong> : null}
                                  {evidence.snippet}
                                </div>
                              ))}
                            </td>
                          ) : null}
                          {editable ? (
                            <td>
                              <button
                                aria-label={referenceEnabled ? "AI reference enabled" : "AI reference disabled"}
                                className={`visibility-toggle ${referenceEnabled ? "enabled" : "disabled"}`}
                                disabled={busy === `reference-${term.id}`}
                                onClick={() => onSetReferenceEnabled?.(term.id, !referenceEnabled)}
                                title={referenceEnabled ? "AI reference enabled" : "AI reference disabled"}
                                type="button"
                              >
                                <img
                                  alt=""
                                  aria-hidden="true"
                                  className="visibility-toggle-icon"
                                  src={referenceEnabled ? "/icons/visibility.png" : "/icons/visibility-off.png"}
                                />
                              </button>
                              {!referenceEnabled ? <span className="badge disabled-badge">Disabled</span> : null}
                            </td>
                          ) : null}
                          {editable ? (
                            <td>
                              {isEditing ? (
                                <div className="table-actions">
                                  <button className="small-button table-action-button" disabled={busy === `update-${term.id}`} onClick={saveEdit} type="button">
                                    Save
                                  </button>
                                  <button className="small-button secondary table-action-button" onClick={cancelEdit} type="button">
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="table-actions">
                                  <button className="small-button secondary table-action-button" onClick={() => startEdit(term)} type="button">
                                    Edit
                                  </button>
                                  <button className="small-button secondary table-action-button" onClick={() => startClone(term)} type="button">
                                    Clone
                                  </button>
                                  <button
                                    className="small-button danger table-action-button"
                                    disabled={busy === `delete-${term.id}`}
                                    onClick={() => onDeleteTerm?.(term.id)}
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pagination-row">
                <span>
                  Showing {pageRangeStart}-{pageRangeEnd} of {activeFolderTerms.length}
                </span>
                <div className="pagination-actions">
                  <button className="small-button secondary" disabled={clampedActivePage <= 1} onClick={() => setActiveFolderPage(clampedActivePage - 1)} type="button">
                    Previous
                  </button>
                  <span className="pagination-page">
                    Page {clampedActivePage} of {pageCount}
                  </span>
                  <button className="small-button secondary" disabled={clampedActivePage >= pageCount} onClick={() => setActiveFolderPage(clampedActivePage + 1)} type="button">
                    Next
                  </button>
                </div>
              </div>
            </section>
          )}
        </>
      )}
      {tagManagerOpen ? (
        <ManageTagDialog
          availableTags={availableTags}
          busy={busy === "tags"}
          editingTag={editingTag}
          onCancelEdit={() => setEditingTag(null)}
          onClose={() => {
            setEditingTag(null);
            setTagManagerOpen(false);
          }}
          onDeleteTag={onDeleteTag}
          onRenameDraftChange={setTagRenameDraft}
          onSaveEdit={saveTagEdit}
          onStartEdit={startTagEdit}
          tagRenameDraft={tagRenameDraft}
        />
      ) : null}
      {addTranslationOpen ? (
        <AddTranslationDialog
          busy={busy === "add-translation"}
          initialTerm={cloneSourceTerm ?? undefined}
          mode={cloneSourceTerm ? "clone" : "add"}
          onAdd={(term) => {
            onAddTerm?.(term);
            closeAddTranslationDialog();
          }}
          onClose={closeAddTranslationDialog}
        />
      ) : null}
    </div>
  );
}

function CloudSyncBadge({
  busy,
  onSyncNow,
  sync
}: {
  busy: boolean;
  onSyncNow?: () => void;
  sync: CloudSyncStatus;
}) {
  const label = cloudSyncBadgeLabel(sync);
  const tone = cloudSyncBadgeTone(sync);

  return (
    <div className={`cloud-sync-badge ${tone}`} title={label}>
      <span className={`signal-dot ${sync.connected ? "connected" : sync.enabled ? "failed" : "missing"}`} aria-hidden="true" />
      <span>{label}</span>
      <button className="small-button secondary" disabled={busy} onClick={onSyncNow} type="button">
        {busy ? "Syncing..." : "Sync Now"}
      </button>
    </div>
  );
}

function ProductsPanel({
  busy,
  campaigns,
  cloudSync,
  onAddProduct,
  onCreateCampaign,
  onDeleteCampaign,
  onDeleteProduct,
  onRenameCampaign,
  onSelectCampaign,
  onSyncNow,
  onUpdateProduct,
  onUploadProducts,
  products,
  selectedCampaignId
}: {
  busy?: string | null;
  campaigns: Campaign[];
  cloudSync?: CloudSyncStatus;
  onAddProduct: (product: { discountedPrice: number; productName: string; rrp: number }) => Promise<boolean>;
  onCreateCampaign: (name: string) => Promise<Campaign | null>;
  onDeleteCampaign: (campaignId: string) => void;
  onDeleteProduct: (productId: string, campaignId?: string) => void;
  onRenameCampaign: (campaignId: string, name: string) => void;
  onSelectCampaign: (campaignId: string) => void;
  onSyncNow?: () => void;
  onUpdateProduct: (product: Product, campaignId?: string) => void;
  onUploadProducts: (rows: ProductUploadRow[], override?: boolean, campaignId?: string) => Promise<void>;
  products: Product[];
  selectedCampaignId: string;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Product | null>(null);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [campaignManagerOpen, setCampaignManagerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCampaignPricesOnly, setShowCampaignPricesOnly] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === selectedCampaignId);
  const campaignMode = Boolean(selectedCampaignId);
  const filteredProducts = products.filter(
    (product) => matchesProductSearch(product, searchQuery) && (!showCampaignPricesOnly || (product.hasCampaignPrice && product.discountedPrice !== product.defaultDiscountedPrice))
  );
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / LIBRARY_PAGE_SIZE));
  const clampedPage = Math.min(currentPage, pageCount);
  const pageStartIndex = (clampedPage - 1) * LIBRARY_PAGE_SIZE;
  const paginatedProducts = filteredProducts.slice(pageStartIndex, pageStartIndex + LIBRARY_PAGE_SIZE);
  const pageRangeStart = filteredProducts.length === 0 ? 0 : pageStartIndex + 1;
  const pageRangeEnd = Math.min(pageStartIndex + paginatedProducts.length, filteredProducts.length);

  useEffect(() => {
    if (currentPage <= pageCount) return;
    setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  useEffect(() => {
    if (campaignMode) return;
    setShowCampaignPricesOnly(false);
  }, [campaignMode]);

  function startEdit(product: Product) {
    setEditingId(product.id);
    setDraft({ ...product });
  }

  function startCampaignPriceEdit(product: Product) {
    setEditingId(product.id);
    setDraft({
      ...product,
      discountedPrice: product.defaultDiscountedPrice ?? product.discountedPrice
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
  }

  function saveEdit() {
    if (!draft) return;
    onUpdateProduct(draft, selectedCampaignId);
    cancelEdit();
  }

  return (
    <div className="content products-content">
      <div className="panel stack">
        <div className="panel-title-row">
          <div>
            <h2>Products</h2>
            <p>{campaignMode ? `Manage discounted price overrides for ${selectedCampaign?.name ?? "selected campaign"}.` : "Manage product RRP and discounted prices."}</p>
          </div>
          <div className="library-header-actions">
            {cloudSync ? <CloudSyncBadge busy={busy === "products-cloud-sync"} onSyncNow={onSyncNow} sync={cloudSync} /> : null}
            <button className="button secondary" onClick={() => setAddProductOpen(true)} type="button">
              Add Product
            </button>
            <button className="button secondary" onClick={() => setCampaignManagerOpen(true)} type="button">
              Manage Campaign
            </button>
            <button className="button" onClick={() => setUploadOpen(true)} type="button">
              Upload Product
            </button>
          </div>
        </div>
        <div className="product-toolbar-row">
          <label className="field">
            <span>Price book</span>
            <select className="select" onChange={(event) => onSelectCampaign(event.target.value)} suppressHydrationWarning value={selectedCampaignId}>
              <option value="">Default Price Book</option>
              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </label>
          <input
            className="input"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search products"
            suppressHydrationWarning
            value={searchQuery}
          />
          <label className="campaign-price-filter">
            <input
              checked={showCampaignPricesOnly}
              disabled={!campaignMode}
              onChange={(event) => setShowCampaignPricesOnly(event.target.checked)}
              suppressHydrationWarning
              type="checkbox"
            />
            <span>Show Campaign Prices Only</span>
          </label>
        </div>
        {products.length === 0 ? (
          <p>No product pricing yet. Upload an .xls or .xlsx file to get started.</p>
        ) : filteredProducts.length === 0 ? (
          <p>No products match your search.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="table products-table">
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>RRP</th>
                    <th>Discounted Price</th>
                    <th>Difference</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => {
                    const isEditing = editingId === product.id && draft;
                    const isCampaignFallback = campaignMode && !product.hasCampaignPrice;
                    return (
                      <tr key={product.id}>
                        <td>
                          {isEditing && !campaignMode ? (
                            <input
                              className="table-input"
                              onChange={(event) => setDraft({ ...draft, productName: event.target.value })}
                              suppressHydrationWarning
                              value={draft.productName}
                            />
                          ) : (
                            <span className="product-name-cell">
                              <span>{product.productName}</span>
                              {isCampaignFallback ? <span className="default-price-badge">Default Price</span> : null}
                            </span>
                          )}
                        </td>
                        <td>
                          {isEditing && !campaignMode ? (
                            <input
                              className="table-input"
                              inputMode="decimal"
                              onChange={(event) => setDraft({ ...draft, rrp: Number(event.target.value) })}
                              suppressHydrationWarning
                              type="number"
                              value={draft.rrp}
                            />
                          ) : (
                            formatPriceNumber(product.rrp)
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              className="table-input"
                              inputMode="decimal"
                              onChange={(event) => setDraft({ ...draft, discountedPrice: Number(event.target.value) })}
                              suppressHydrationWarning
                              type="number"
                              value={draft.discountedPrice}
                            />
                          ) : (
                            <span className={campaignMode && product.hasCampaignPrice && product.discountedPrice !== product.defaultDiscountedPrice ? "campaign-price-changed" : ""}>
                              {formatPriceNumber(product.discountedPrice)}
                            </span>
                          )}
                        </td>
                        <td>{formatPriceNumber(isEditing ? draft.rrp - draft.discountedPrice : product.priceDifference)}</td>
                        <td>
                          {isEditing ? (
                            <div className="table-actions">
                              <button className="small-button table-action-button" disabled={busy === `product-update-${product.id}`} onClick={saveEdit} type="button">
                                Save
                              </button>
                              <button className="small-button secondary table-action-button" onClick={cancelEdit} type="button">
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="table-actions">
                              {isCampaignFallback ? (
                                <button className="small-button secondary table-action-button" onClick={() => startCampaignPriceEdit(product)} type="button">
                                  Add Campaign Price
                                </button>
                              ) : (
                                <>
                                  <button className="small-button secondary table-action-button" onClick={() => startEdit(product)} type="button">
                                    Edit
                                  </button>
                                  <button
                                    className="small-button danger table-action-button"
                                    disabled={busy === `product-delete-${product.id}`}
                                    onClick={() => onDeleteProduct(product.id, selectedCampaignId)}
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="pagination-row">
              <span>
                Showing {pageRangeStart}-{pageRangeEnd} of {filteredProducts.length}
              </span>
              <div className="pagination-actions">
                <button className="small-button secondary" disabled={clampedPage <= 1} onClick={() => setCurrentPage(clampedPage - 1)} type="button">
                  Previous
                </button>
                <span className="pagination-page">
                  Page {clampedPage} of {pageCount}
                </span>
                <button className="small-button secondary" disabled={clampedPage >= pageCount} onClick={() => setCurrentPage(clampedPage + 1)} type="button">
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {addProductOpen ? (
        <AddProductDialog
          busy={busy === "add-product"}
          existingProducts={products}
          onAdd={async (product) => {
            const saved = await onAddProduct(product);
            if (saved) setAddProductOpen(false);
          }}
          onClose={() => setAddProductOpen(false)}
        />
      ) : null}
      {uploadOpen ? (
        <UploadProductDialog
          busy={busy === "products-upload"}
          onClose={() => setUploadOpen(false)}
          campaigns={campaigns}
          onCreateCampaign={onCreateCampaign}
          onUpload={async (rows, override) => {
            await onUploadProducts(rows, override, "");
            setUploadOpen(false);
          }}
          onUploadToCampaign={async (rows, override, campaignId) => {
            await onUploadProducts(rows, override, campaignId);
            onSelectCampaign(campaignId);
            setUploadOpen(false);
          }}
        />
      ) : null}
      {campaignManagerOpen ? (
        <ManageCampaignDialog
          busy={busy === "campaigns"}
          campaigns={campaigns}
          onClose={() => setCampaignManagerOpen(false)}
          onCreateCampaign={onCreateCampaign}
          onDeleteCampaign={onDeleteCampaign}
          onRenameCampaign={onRenameCampaign}
        />
      ) : null}
    </div>
  );
}

function AddProductDialog({
  busy,
  existingProducts,
  onAdd,
  onClose
}: {
  busy: boolean;
  existingProducts: Product[];
  onAdd: (product: { discountedPrice: number; productName: string; rrp: number }) => void;
  onClose: () => void;
}) {
  const [productName, setProductName] = useState("");
  const [rrp, setRrp] = useState("");
  const [discountedPrice, setDiscountedPrice] = useState("");
  const normalizedName = productName.trim().replace(/\s+/g, " ");
  const duplicateProduct = existingProducts.some((product) => product.productName.trim().toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
  const rrpValue = Number(rrp);
  const discountedPriceValue = Number(discountedPrice);
  const canSave = Boolean(normalizedName && rrp.trim() && discountedPrice.trim()) && Number.isFinite(rrpValue) && Number.isFinite(discountedPriceValue) && !duplicateProduct;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  function submit() {
    if (!canSave) return;
    onAdd({
      discountedPrice: discountedPriceValue,
      productName: normalizedName,
      rrp: rrpValue
    });
  }

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack add-translation-dialog" role="dialog" aria-modal="true" aria-labelledby="add-product-title">
        <div>
          <h2 id="add-product-title">Add Product</h2>
          <p className="modal-copy">Manually add one product to the Default Price Book.</p>
        </div>
        <label className="field">
          <span>Product Name</span>
          <input
            autoFocus
            className="input"
            onChange={(event) => setProductName(event.target.value)}
            placeholder="Eureka J15 Pro Ultra"
            suppressHydrationWarning
            value={productName}
          />
        </label>
        <div className="translation-field-grid">
          <label className="field">
            <span>RRP</span>
            <input
              className="input"
              inputMode="decimal"
              min="0"
              onChange={(event) => setRrp(event.target.value)}
              placeholder="799.99"
              step="0.01"
              suppressHydrationWarning
              type="number"
              value={rrp}
            />
          </label>
          <label className="field">
            <span>Discounted Price</span>
            <input
              className="input"
              inputMode="decimal"
              min="0"
              onChange={(event) => setDiscountedPrice(event.target.value)}
              placeholder="499.99"
              step="0.01"
              suppressHydrationWarning
              type="number"
              value={discountedPrice}
            />
          </label>
        </div>
        {duplicateProduct ? <p className="error-text">This product already exists in the price book.</p> : null}
        <div className="modal-actions">
          <button className="button" disabled={busy || !canSave} onClick={submit} type="button">
            {busy ? "Adding..." : "Add"}
          </button>
          <button className="button secondary" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function UploadProductDialog({
  busy,
  campaigns,
  onClose,
  onCreateCampaign,
  onUpload,
  onUploadToCampaign
}: {
  busy: boolean;
  campaigns: Campaign[];
  onClose: () => void;
  onCreateCampaign: (name: string) => Promise<Campaign | null>;
  onUpload: (rows: ProductUploadRow[], override?: boolean) => Promise<void>;
  onUploadToCampaign: (rows: ProductUploadRow[], override: boolean, campaignId: string) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [errors, setErrors] = useState<Array<{ message: string; rowNumber: number }>>([]);
  const [rows, setRows] = useState<ProductUploadRow[]>([]);
  const [campaignDraft, setCampaignDraft] = useState("");
  const [status, setStatus] = useState("Excel format: Column A Product Name, Column B RRP, Column C Discounted Price.");
  const campaignMode = Boolean(campaignDraft.trim());

  async function resolveCampaignDraft(): Promise<string> {
    const name = campaignDraft.trim();
    if (!name) return "";
    const existing = campaigns.find((campaign) => campaign.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (existing) return existing.id;
    const campaign = await onCreateCampaign(name);
    if (!campaign) throw new Error("Campaign could not be created.");
    setCampaignDraft(campaign.name);
    return campaign.id;
  }

  function updateCampaignDraft(value: string) {
    setCampaignDraft(value);
    setDuplicates([]);
    setErrors([]);
    setRows([]);
    setStatus("Excel format: Column A Product Name, Column B RRP, Column C Discounted Price.");
  }

  async function previewUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setStatus("Choose an .xls or .xlsx file first.");
      return;
    }
    let campaignId = "";
    try {
      campaignId = await resolveCampaignDraft();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Campaign could not be created.");
      return;
    }
    const formData = new FormData();
    formData.set("file", file);
    if (campaignId) formData.set("campaignId", campaignId);
    const response = await fetch("/api/products/upload", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Product upload failed");
      return;
    }
    setErrors(data.errors ?? []);
    setDuplicates(data.duplicates ?? []);
    setRows(data.products ?? []);
    if ((data.errors ?? []).length > 0) {
      setStatus(`${data.errors.length} row${data.errors.length === 1 ? "" : "s"} need fixing before import.`);
      return;
    }
    if ((data.products ?? []).length === 0) {
      setStatus("No valid product rows found.");
      return;
    }
    if ((data.duplicates ?? []).length > 0) {
      setStatus(`${data.duplicates.length} duplicate product${data.duplicates.length === 1 ? "" : "s"} found.`);
      return;
    }
    if (campaignId) {
      await onUploadToCampaign(data.products ?? [], false, campaignId);
    } else {
      await onUpload(data.products ?? [], false);
    }
  }

  async function overrideDuplicates() {
    if (rows.length === 0 || errors.length > 0) return;
    let campaignId = "";
    try {
      campaignId = await resolveCampaignDraft();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Campaign could not be created.");
      return;
    }
    if (campaignId) {
      await onUploadToCampaign(rows, true, campaignId);
    } else {
      await onUpload(rows, true);
    }
  }

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack" role="dialog" aria-modal="true" aria-labelledby="upload-products-title">
        <div>
          <h2 id="upload-products-title">Upload Product</h2>
          <p className="modal-copy">
            Campaign uploads store Column C as discounted price overrides. RRP stays from the default price book.
          </p>
          <p className="modal-copy">
            <a href="https://docs.google.com/spreadsheets/d/1WoIGjloo_t99AOljaYY3RHnWxFVDxfivG-Gy6sViagg/edit?usp=sharing" rel="noopener noreferrer" target="_blank">
              Sample spreadsheet (Google Sheets)
            </a>{" "}
            — teammates can edit online and export their own campaign Excel.
          </p>
          {!campaignMode ? <p className="modal-copy">Leave campaign blank to update Default Price Book.</p> : null}
        </div>
        <label className="field">
          <span>Select / Add campaign</span>
          <input
            className="input"
            list="upload-campaign-options"
            onChange={(event) => updateCampaignDraft(event.target.value)}
            placeholder="Type to add campaign or select a campaign"
            suppressHydrationWarning
            value={campaignDraft}
          />
          <datalist id="upload-campaign-options">
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.name} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>Excel file</span>
          <input ref={fileInputRef} accept=".xls,.xlsx" className="input" type="file" />
        </label>
        <div className="status-line">{status}</div>
        {errors.length > 0 ? (
          <div className="upload-issue-list">
            {errors.slice(0, 8).map((error) => (
              <div key={`${error.rowNumber}-${error.message}`}>
                Row {error.rowNumber}: {error.message}
              </div>
            ))}
          </div>
        ) : null}
        {duplicates.length > 0 ? (
          <div className="upload-issue-list">
            <strong>Duplicated Product Name</strong>
            {duplicates.slice(0, 12).map((duplicate) => (
              <div key={duplicate}>{duplicate}</div>
            ))}
            {duplicates.length > 12 ? <div>+ {duplicates.length - 12} more duplicates</div> : null}
          </div>
        ) : null}
        <div className="modal-actions">
          {duplicates.length > 0 && errors.length === 0 ? (
            <button className="button" disabled={busy} onClick={overrideDuplicates} type="button">
              {busy ? "Saving..." : "Override"}
            </button>
          ) : (
            <button className="button" disabled={busy} onClick={previewUpload} type="button">
              {busy ? "Uploading..." : "Upload"}
            </button>
          )}
          <button className="button secondary" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function ProductSyncConflictDialog({
  busy,
  conflicts,
  onCancel,
  onResolve
}: {
  busy: boolean;
  conflicts: ProductSyncConflict[];
  onCancel: () => void;
  onResolve: (resolutions: Array<{ action: "overwrite" | "skip"; productId: string }>) => void;
}) {
  const [resolutions, setResolutions] = useState<Record<string, "overwrite" | "skip">>(
    Object.fromEntries(conflicts.map((conflict) => [conflict.productId, "skip"]))
  );

  useEffect(() => {
    setResolutions(Object.fromEntries(conflicts.map((conflict) => [conflict.productId, "skip"])));
  }, [conflicts]);

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack sync-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="product-sync-conflict-title">
        <div>
          <h2 id="product-sync-conflict-title">Product Sync Conflicts</h2>
          <p className="modal-copy">Supabase has newer changes for these Products. Choose what to do for each product.</p>
        </div>
        <div className="sync-conflict-list">
          {conflicts.map((conflict) => (
            <div className="sync-conflict-item" key={`${conflict.type}-${conflict.productId}`}>
              <div className="sync-conflict-copy">
                <strong>{conflict.localProduct?.productName || conflict.cloudProduct?.productName || conflict.productId}</strong>
                <span className="badge">{conflict.type === "delete" ? "Local delete conflict" : "Edit conflict"}</span>
              </div>
              <div className="sync-conflict-compare">
                <div>
                  <span className="muted-text">Your local</span>
                  <p>{productConflictCopy(conflict.localProduct)}</p>
                </div>
                <div>
                  <span className="muted-text">Supabase</span>
                  <p>{productConflictCopy(conflict.cloudProduct)}</p>
                </div>
              </div>
              <div className="sync-conflict-actions">
                <label>
                  <input
                    checked={(resolutions[conflict.productId] ?? "skip") === "overwrite"}
                    disabled={busy}
                    name={`product-sync-conflict-${conflict.productId}`}
                    onChange={() => setResolutions((current) => ({ ...current, [conflict.productId]: "overwrite" }))}
                    type="radio"
                  />
                  Overwrite
                </label>
                <label>
                  <input
                    checked={(resolutions[conflict.productId] ?? "skip") === "skip"}
                    disabled={busy}
                    name={`product-sync-conflict-${conflict.productId}`}
                    onChange={() => setResolutions((current) => ({ ...current, [conflict.productId]: "skip" }))}
                    type="radio"
                  />
                  Skip
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => onResolve(conflicts.map((conflict) => ({ action: resolutions[conflict.productId] ?? "skip", productId: conflict.productId })))}
            type="button"
          >
            {busy ? "Applying..." : "Apply Choices"}
          </button>
          <button className="button secondary" disabled={busy} onClick={onCancel} type="button">
            Cancel Sync
          </button>
        </div>
      </section>
    </div>
  );
}

function matchesProductSearch(product: Product, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return [product.productName, String(product.rrp), String(product.discountedPrice), String(product.priceDifference)].join(" ").toLocaleLowerCase().includes(normalizedQuery);
}

function formatPriceNumber(value: number): string {
  return Number.isFinite(value)
    ? new Intl.NumberFormat("de-DE", {
        maximumFractionDigits: 2,
        minimumFractionDigits: Number.isInteger(value) ? 0 : 2
      }).format(value)
    : "0";
}

function productConflictCopy(product?: Product): string {
  if (!product) return "Deleted";
  return `${product.productName} | RRP ${formatPriceNumber(product.rrp)} | Discounted ${formatPriceNumber(product.discountedPrice)} | Difference ${formatPriceNumber(product.priceDifference)}`;
}

function AddTranslationDialog({
  busy,
  initialTerm,
  mode = "add",
  onAdd,
  onClose
}: {
  busy: boolean;
  initialTerm?: Term;
  mode?: "add" | "clone";
  onAdd: (term: Term) => void;
  onClose: () => void;
}) {
  const [canonical, setCanonical] = useState(initialTerm?.canonical ?? "");
  const [type, setType] = useState<Term["type"]>(initialTerm?.type ?? "product_name");
  const [translations, setTranslations] = useState<Record<Locale, string>>({
    DE: initialTerm?.translations.DE ?? "",
    FR: initialTerm?.translations.FR ?? "",
    IT: initialTerm?.translations.IT ?? "",
    ES: initialTerm?.translations.ES ?? ""
  });
  const canSave = canonical.trim().length > 0;
  const isClone = mode === "clone";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  function submit() {
    const normalizedCanonical = canonical.trim();
    if (!normalizedCanonical) return;
    const now = new Date().toISOString();
    const nextTranslations = Object.fromEntries(
      locales
        .map((locale) => [locale, translations[locale].trim()] as const)
        .filter(([, value]) => Boolean(value))
    ) as Term["translations"];

    onAdd({
      id: createId("term"),
      projectId: "internal_library",
      canonical: normalizedCanonical,
      type,
      folderId: folderForTermType(type),
      translations: nextTranslations,
      evidence: [],
      tags: initialTerm?.tags ? [...initialTerm.tags] : [],
      confidence: 1,
      status: "approved",
      updatedAt: now
    });
  }

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack add-translation-dialog" role="dialog" aria-modal="true" aria-labelledby="add-translation-title">
        <div>
          <h2 id="add-translation-title">{isClone ? "Clone Translation" : "Add Translation"}</h2>
          <p className="modal-copy">{isClone ? "Create a new Library entity from this translation." : "Manually add one Library entity."}</p>
        </div>
        <label className="field">
          <span>Category</span>
          <select className="select" onChange={(event) => setType(event.target.value as Term["type"])} suppressHydrationWarning value={type}>
            {termTypes.map((termType) => (
              <option key={termType} value={termType}>
                {termType}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>EN</span>
          <input
            autoFocus
            className="input"
            onChange={(event) => setCanonical(event.target.value)}
            placeholder="English source text"
            suppressHydrationWarning
            value={canonical}
          />
        </label>
        <div className="translation-field-grid">
          {locales.map((locale) => (
            <label className="field" key={locale}>
              <span>{locale}</span>
              <input
                className="input"
                onChange={(event) => setTranslations((current) => ({ ...current, [locale]: event.target.value }))}
                placeholder={`${locale} translation`}
                suppressHydrationWarning
                value={translations[locale]}
              />
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button className="button" disabled={busy || !canSave} onClick={submit} type="button">
            {busy ? (isClone ? "Saving..." : "Adding...") : isClone ? "Save Clone" : "Add"}
          </button>
          <button className="button secondary" disabled={busy} onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

function ManageTagDialog({
  availableTags,
  busy,
  editingTag,
  onCancelEdit,
  onClose,
  onDeleteTag,
  onRenameDraftChange,
  onSaveEdit,
  onStartEdit,
  tagRenameDraft
}: {
  availableTags: string[];
  busy: boolean;
  editingTag: string | null;
  onCancelEdit: () => void;
  onClose: () => void;
  onDeleteTag?: (tag: string) => void;
  onRenameDraftChange: (value: string) => void;
  onSaveEdit: () => void;
  onStartEdit: (tag: string) => void;
  tagRenameDraft: string;
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(availableTags.length / TAG_MANAGER_PAGE_SIZE));
  const clampedPage = Math.min(currentPage, pageCount);
  const pageStartIndex = (clampedPage - 1) * TAG_MANAGER_PAGE_SIZE;
  const paginatedTags = availableTags.slice(pageStartIndex, pageStartIndex + TAG_MANAGER_PAGE_SIZE);
  const pageRangeStart = availableTags.length === 0 ? 0 : pageStartIndex + 1;
  const pageRangeEnd = Math.min(pageStartIndex + paginatedTags.length, availableTags.length);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  useEffect(() => {
    if (currentPage <= pageCount) return;
    setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack tag-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-tag-title">
        <div className="panel-title-row">
          <div>
            <h2 id="manage-tag-title">Manage Tag</h2>
            <p className="modal-copy">Edit or delete Library tags.</p>
          </div>
          <button className="small-button secondary" disabled={busy} onClick={onClose} type="button">
            Close
          </button>
        </div>
        {availableTags.length === 0 ? (
          <p className="muted-text">No tags yet.</p>
        ) : (
          <>
            <div className="tag-manager-list">
              {paginatedTags.map((tag) => (
                <div className="tag-manager-item" key={tag}>
                  {editingTag === tag ? (
                    <>
                      <input
                        autoFocus
                        className="table-input"
                        onChange={(event) => onRenameDraftChange(event.target.value)}
                        suppressHydrationWarning
                        value={tagRenameDraft}
                      />
                      <button className="small-button" disabled={busy || !tagRenameDraft.trim()} onClick={onSaveEdit} type="button">
                        Save
                      </button>
                      <button className="small-button secondary" disabled={busy} onClick={onCancelEdit} type="button">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="tag-chip">{tag}</span>
                      <button className="small-button secondary" disabled={busy} onClick={() => onStartEdit(tag)} type="button">
                        Edit
                      </button>
                      <button className="small-button danger" disabled={busy} onClick={() => onDeleteTag?.(tag)} type="button">
                        Delete
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div className="pagination-row tag-manager-pagination">
              <span>
                Showing {pageRangeStart}-{pageRangeEnd} of {availableTags.length}
              </span>
              <div className="pagination-actions">
                <button className="small-button secondary" disabled={busy || clampedPage <= 1} onClick={() => setCurrentPage(clampedPage - 1)} type="button">
                  Previous
                </button>
                <span className="pagination-page">
                  Page {clampedPage} of {pageCount}
                </span>
                <button className="small-button secondary" disabled={busy || clampedPage >= pageCount} onClick={() => setCurrentPage(clampedPage + 1)} type="button">
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ManageCampaignDialog({
  busy,
  campaigns,
  onClose,
  onCreateCampaign,
  onDeleteCampaign,
  onRenameCampaign
}: {
  busy: boolean;
  campaigns: Campaign[];
  onClose: () => void;
  onCreateCampaign: (name: string) => Promise<Campaign | null>;
  onDeleteCampaign: (campaignId: string) => void;
  onRenameCampaign: (campaignId: string, name: string) => void;
}) {
  const [newCampaignName, setNewCampaignName] = useState("");
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onClose]);

  async function createCampaign() {
    const campaign = await onCreateCampaign(newCampaignName);
    if (campaign) setNewCampaignName("");
  }

  function startRename(campaign: Campaign) {
    setEditingCampaignId(campaign.id);
    setRenameDraft(campaign.name);
  }

  function saveRename() {
    if (!editingCampaignId || !renameDraft.trim()) return;
    onRenameCampaign(editingCampaignId, renameDraft);
    setEditingCampaignId(null);
    setRenameDraft("");
  }

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-dialog stack tag-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-campaign-title">
        <div className="panel-title-row">
          <div>
            <h2 id="manage-campaign-title">Manage Campaign</h2>
            <p className="modal-copy">Create, rename, or delete campaign price books.</p>
          </div>
          <button className="small-button secondary" disabled={busy} onClick={onClose} type="button">
            Close
          </button>
        </div>
        <div className="campaign-create-row">
          <input
            className="input"
            onChange={(event) => setNewCampaignName(event.target.value)}
            placeholder="New campaign name"
            suppressHydrationWarning
            value={newCampaignName}
          />
          <button className="small-button" disabled={busy || !newCampaignName.trim()} onClick={createCampaign} type="button">
            Add
          </button>
        </div>
        {campaigns.length === 0 ? (
          <p className="muted-text">No campaigns yet.</p>
        ) : (
          <div className="tag-manager-list">
            {campaigns.map((campaign) => (
              <div className="tag-manager-item" key={campaign.id}>
                {editingCampaignId === campaign.id ? (
                  <>
                    <input
                      autoFocus
                      className="table-input"
                      onChange={(event) => setRenameDraft(event.target.value)}
                      suppressHydrationWarning
                      value={renameDraft}
                    />
                    <button className="small-button" disabled={busy || !renameDraft.trim()} onClick={saveRename} type="button">
                      Save
                    </button>
                    <button className="small-button secondary" disabled={busy} onClick={() => setEditingCampaignId(null)} type="button">
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="tag-chip">{campaign.name}</span>
                    <button className="small-button secondary" disabled={busy} onClick={() => startRename(campaign)} type="button">
                      Edit
                    </button>
                    <button className="small-button danger" disabled={busy} onClick={() => onDeleteCampaign(campaign.id)} type="button">
                      Delete
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function matchesTermSearch(term: Term, query: string, mode: "all" | "tag") {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;

  if (mode === "tag") {
    return (term.tags ?? []).some((tag) => tag.toLocaleLowerCase().includes(normalizedQuery));
  }

  const searchableText = [
    term.canonical,
    term.type,
    ...(term.tags ?? []),
    ...locales.map((locale) => term.translations[locale as Locale] ?? ""),
    ...term.evidence.map((evidence) => `${evidence.locale ?? ""} ${evidence.snippet}`)
  ]
    .join(" ")
    .toLocaleLowerCase();

  return searchableText.includes(normalizedQuery);
}
