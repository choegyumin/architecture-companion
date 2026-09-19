import { addEventListener } from "@base-ui/utils/addEventListener";
import { FolderSearch, MessageSquarePlus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { DataClient } from "@/client/data-client";
import type {
  AnnotationEdit,
  AnnotationEditConflictResolution,
  AnnotationReviewController,
} from "@/client/parts/annotation-layer";
import { DiagramList } from "@/client/parts/diagram-list";
import { DiagramRenderer } from "@/client/widgets/diagram-renderer";
import type { AnnotationAnchor, AnnotationDocument } from "@/features/annotation/annotation-document";
import { type AnnotationDraft, createAnnotationDraft } from "@/features/annotation/create-annotation-draft";
import { createAnnotations } from "@/features/annotation/manage-annotations";
import type { RevisionAnnotationsRead } from "@/features/annotation/revision-annotations";
import type { ArtifactRevisionId } from "@/features/artifact/artifact-revision-id";
import { confirmDialog } from "@/shared/react-ui/alert-dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/react-ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/react-ui/tabs";
import { ThemeToggle } from "@/shared/react-ui/theme-toggle";
import { Toggle } from "@/shared/react-ui/toggle";

type ReviewResponse = Awaited<ReturnType<DataClient["getReview"]>>;
type ReviewBundle = Readonly<{
  annotations: RevisionAnnotationsRead;
  review: ReviewResponse;
}>;

type ReviewLoadMode = "initial" | "refresh";
type ReviewView = "design" | "process";

type ReviewState =
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      artifactRevisionId: ArtifactRevisionId | null;
      review: ReviewResponse;
      annotations: AnnotationDocument;
      operationId?: string;
      updateError?: string;
    }>
  | Readonly<{ status: "error"; message: string }>;

type ReviewEvent =
  | Readonly<{ type: "load-succeeded"; mode: ReviewLoadMode; bundle: ReviewBundle }>
  | Readonly<{ type: "load-failed"; mode: ReviewLoadMode; message: string }>
  | Readonly<{
      type: "annotation-operation-started";
      artifactRevisionId: ArtifactRevisionId;
      operationId: string;
    }>
  | Readonly<{
      type: "annotations-updated";
      artifactRevisionId: ArtifactRevisionId;
      operationId: string;
      annotations: AnnotationDocument;
    }>;

type AnnotationState = Readonly<{
  artifactRevisionId: ArtifactRevisionId | null;
  draft?: AnnotationDraft;
  draftError?: string;
  edit?: AnnotationEdit;
  editError?: string;
  isManaging: boolean;
  isModeEnabled: boolean;
  isPublishing: boolean;
  operationId?: string;
}>;

type AnnotationEvent =
  | Readonly<{ type: "mode-changed"; enabled: boolean }>
  | Readonly<{ type: "draft-began"; draft: AnnotationDraft }>
  | Readonly<{ type: "draft-changed"; body: string }>
  | Readonly<{ type: "draft-cancelled" }>
  | Readonly<{ type: "publish-started"; operationId: string }>
  | Readonly<{
      type: "publish-succeeded";
      artifactRevisionId: ArtifactRevisionId;
      operationId: string;
    }>
  | Readonly<{
      type: "publish-failed";
      artifactRevisionId: ArtifactRevisionId;
      operationId: string;
      draft: AnnotationDraft;
      message: string;
    }>
  | Readonly<{ type: "edit-opened"; edit: AnnotationEdit }>
  | Readonly<{ type: "edit-changed"; body: string }>
  | Readonly<{ type: "edit-closed" }>
  | Readonly<{ type: "management-started"; operationId: string }>
  | Readonly<{
      type: "edit-management-succeeded";
      artifactRevisionId: ArtifactRevisionId;
      operationId: string;
    }>
  | Readonly<{
      type: "management-failed";
      artifactRevisionId: ArtifactRevisionId;
      operationId: string;
      message: string;
      fallbackEdit?: AnnotationEdit;
    }>
  | Readonly<{ type: "edit-conflict-resolved"; edit?: AnnotationEdit }>
  | Readonly<{ type: "annotations-refreshed"; annotations: RevisionAnnotationsRead }>
  | Readonly<{
      type: "move-succeeded";
      artifactRevisionId: ArtifactRevisionId;
      operationId: string;
      annotations: AnnotationDocument;
    }>;

const MAX_REVIEW_BUNDLE_ATTEMPTS = 3;
const ANNOTATION_MODE_HOLD_KEY = "Alt";

function hasConflictingModifier(event: KeyboardEvent, holdKey: string): boolean {
  const modifiers = ["Alt", "Control", "Meta", "Shift"] as const;
  return modifiers.some((modifierKey) => modifierKey !== holdKey && event.getModifierState(modifierKey));
}

const emptyAnnotationDocument: AnnotationDocument = { annotations: [] };
const emptyRevisionAnnotations: RevisionAnnotationsRead = {
  artifactRevisionId: null,
  document: null,
};

const initialAnnotationState: AnnotationState = {
  artifactRevisionId: null,
  isManaging: false,
  isModeEnabled: false,
  isPublishing: false,
};

type WorkspacePageProps = Readonly<{
  client: DataClient;
}>;

type WorkspaceShellProps = Readonly<{
  actions?: ReactNode;
  children: ReactNode;
  navigation?: ReactNode;
  scopeName: string;
}>;

function WorkspaceShell({ actions, children, navigation, scopeName }: WorkspaceShellProps) {
  return (
    <main className="flex h-dvh w-full min-w-0 flex-col gap-0.5 overflow-hidden">
      <header className="grid min-h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 px-8">
        <h1 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="shrink-0">Architecture Companion</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="truncate text-muted-foreground" title={scopeName}>
            {scopeName}
          </span>
        </h1>

        <div className="justify-self-center">{navigation}</div>

        <div className="flex items-center gap-2 justify-self-end">
          <ThemeToggle />
          {actions}
        </div>
      </header>

      <div className="flex flex-1 p-5 pt-0">
        <div className="flex-1 rounded-3xl bg-muted p-3">{children}</div>
      </div>
    </main>
  );
}

function getReviewErrorMessage(review: ReviewResponse): string | undefined {
  if (!("error" in review)) return undefined;

  const error = review.error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Artifact is invalid.";
}

function getReviewArtifactRevisionId(review: ReviewResponse): ArtifactRevisionId | null {
  return "artifactRevisionId" in review ? review.artifactRevisionId : null;
}

function hasUnsavedAnnotationChanges(state: AnnotationState): boolean {
  return Boolean(state.draft?.body.trim() || (state.edit && state.edit.body !== state.edit.source.comment.body));
}

function isSameAnnotation(left: AnnotationEdit["source"], right: AnnotationEdit["source"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconcileAnnotationEdit(edit: AnnotationEdit, document: AnnotationDocument): AnnotationEdit {
  const external = document.annotations.find((annotation) => annotation.comment.id === edit.source.comment.id);
  if (!external) return { ...edit, conflict: { kind: "deleted" } };
  if (isSameAnnotation(edit.source, external)) return edit;

  return { ...edit, conflict: { kind: "changed", external } };
}

function reviewReducer(state: ReviewState, event: ReviewEvent): ReviewState {
  if (event.type === "annotation-operation-started") {
    return state.status === "ready" && state.artifactRevisionId === event.artifactRevisionId
      ? { ...state, operationId: event.operationId }
      : state;
  }

  if (event.type === "annotations-updated") {
    return state.status === "ready" &&
      state.artifactRevisionId === event.artifactRevisionId &&
      state.operationId === event.operationId
      ? { ...state, annotations: event.annotations, operationId: undefined }
      : state;
  }

  if (event.type === "load-failed") {
    if (event.mode === "refresh" && state.status === "ready" && state.review.artifact) {
      return { ...state, updateError: event.message };
    }

    return { status: "error", message: event.message };
  }

  const { annotations, review } = event.bundle;
  const updateError = getReviewErrorMessage(review);
  if (event.mode === "refresh" && updateError && state.status === "ready" && state.review.artifact) {
    return { ...state, artifactRevisionId: null, operationId: undefined, updateError };
  }

  const artifactRevisionId = annotations.artifactRevisionId;
  return {
    status: "ready",
    artifactRevisionId,
    review,
    annotations: annotations.document ?? emptyAnnotationDocument,
    operationId:
      state.status === "ready" && state.artifactRevisionId === artifactRevisionId ? state.operationId : undefined,
  };
}

function annotationReducer(state: AnnotationState, event: AnnotationEvent): AnnotationState {
  if (event.type === "annotations-refreshed") {
    if (event.annotations.artifactRevisionId !== state.artifactRevisionId) {
      return {
        artifactRevisionId: event.annotations.artifactRevisionId,
        isManaging: false,
        isModeEnabled: state.isModeEnabled,
        isPublishing: false,
      };
    }

    return state.edit && event.annotations.document
      ? { ...state, edit: reconcileAnnotationEdit(state.edit, event.annotations.document) }
      : state;
  }

  switch (event.type) {
    case "mode-changed":
      return { ...state, isModeEnabled: event.enabled };
    case "draft-began":
      if (state.isManaging || state.isPublishing) return state;
      return {
        ...state,
        draft: event.draft,
        draftError: undefined,
        edit: undefined,
        editError: undefined,
      };
    case "draft-changed":
      return state.draft
        ? {
            ...state,
            draft: { ...state.draft, body: event.body },
            draftError: undefined,
          }
        : state;
    case "draft-cancelled":
      return {
        ...state,
        draft: undefined,
        draftError: undefined,
      };
    case "publish-started":
      return state.draft && !state.isPublishing
        ? { ...state, draftError: undefined, isPublishing: true, operationId: event.operationId }
        : state;
    case "publish-succeeded":
      return event.artifactRevisionId === state.artifactRevisionId && event.operationId === state.operationId
        ? {
            ...state,
            draft: undefined,
            draftError: undefined,
            isPublishing: false,
            operationId: undefined,
          }
        : state;
    case "publish-failed":
      return event.artifactRevisionId === state.artifactRevisionId && event.operationId === state.operationId
        ? {
            ...state,
            draft: event.draft,
            draftError: event.message,
            isPublishing: false,
            operationId: undefined,
          }
        : state;
    case "edit-opened":
      if (state.isManaging) return state;
      return {
        ...state,
        draft: undefined,
        draftError: undefined,
        edit: event.edit,
        editError: undefined,
      };
    case "edit-changed":
      return state.edit
        ? {
            ...state,
            edit: { ...state.edit, body: event.body },
            editError: undefined,
          }
        : state;
    case "edit-closed":
      return state.isManaging
        ? state
        : {
            ...state,
            edit: undefined,
            editError: undefined,
          };
    case "management-started":
      return { ...state, editError: undefined, isManaging: true, operationId: event.operationId };
    case "edit-management-succeeded":
      return event.artifactRevisionId === state.artifactRevisionId && event.operationId === state.operationId
        ? {
            ...state,
            edit: undefined,
            editError: undefined,
            isManaging: false,
            operationId: undefined,
          }
        : state;
    case "management-failed":
      return event.artifactRevisionId === state.artifactRevisionId && event.operationId === state.operationId
        ? {
            ...state,
            edit: state.edit ?? event.fallbackEdit,
            editError: event.message,
            isManaging: false,
            operationId: undefined,
          }
        : state;
    case "edit-conflict-resolved":
      return {
        ...state,
        edit: event.edit,
        editError: undefined,
      };
    case "move-succeeded": {
      if (event.artifactRevisionId !== state.artifactRevisionId || event.operationId !== state.operationId) {
        return state;
      }

      const source = event.annotations.annotations.find((annotation) => annotation.id === state.edit?.annotationId);
      return {
        ...state,
        edit: state.edit && source ? { ...state.edit, source } : state.edit,
        isManaging: false,
        operationId: undefined,
      };
    }
  }
}

async function loadReviewBundle(client: DataClient, isCurrent: () => boolean): Promise<ReviewBundle | undefined> {
  for (let attempt = 0; attempt < MAX_REVIEW_BUNDLE_ATTEMPTS && isCurrent(); attempt += 1) {
    const review = await client.getReview();
    const artifactRevisionId = getReviewArtifactRevisionId(review);
    if (artifactRevisionId === null) return { review, annotations: emptyRevisionAnnotations };

    const annotations = await client.getAnnotations();
    if (artifactRevisionId === annotations.artifactRevisionId) return { review, annotations };

    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (isCurrent()) throw new Error("Review and Annotation revisions did not match after reloading.");
  return undefined;
}

export function WorkspacePage({ client }: WorkspacePageProps) {
  const [state, dispatchReview] = useReducer(reviewReducer, { status: "loading" });
  const [annotationState, dispatchAnnotation] = useReducer(annotationReducer, initialAnnotationState);
  const [sourceError, setSourceError] = useState<string>();
  const [requestedReviewView, setRequestedReviewView] = useState<ReviewView>("process");
  const [activeProcessId, setActiveProcessId] = useState("");
  const [activeDesignId, setActiveDesignId] = useState("");
  const activeArtifactRevisionId = state.status === "ready" ? state.artifactRevisionId : null;
  const holdAnnotationMode = useRef(false);
  const pressedKeys = useRef<ReadonlySet<string>>(new Set());
  const annotationRepository = useMemo(
    () => ({
      load: async () => {
        if (!activeArtifactRevisionId) throw new Error("No active Artifact revision is available.");

        const annotations = await client.getAnnotations();
        if (annotations.artifactRevisionId !== activeArtifactRevisionId || annotations.document === null) {
          throw new Error("Artifact revision changed. Reload before saving Annotations.");
        }

        return annotations.document;
      },
      save: async (document: AnnotationDocument, expectedDocument: AnnotationDocument) => {
        await client.saveAnnotations(document, expectedDocument);
      },
    }),
    [activeArtifactRevisionId, client],
  );
  const annotationDrafts = useMemo(
    () =>
      createAnnotationDraft({
        repository: annotationRepository,
        currentUser: {
          load: async () => ({ id: "local-reviewer", name: "Local reviewer" }),
        },
        createId: () => globalThis.crypto.randomUUID(),
        now: () => new Date().toISOString(),
      }),
    [annotationRepository],
  );
  const annotationManager = useMemo(
    () => createAnnotations({ repository: annotationRepository }),
    [annotationRepository],
  );

  const openSource = useCallback(
    async (href: string) => {
      setSourceError(undefined);
      try {
        await client.openSource(href);
      } catch (error) {
        setSourceError(error instanceof Error ? error.message : "Source file could not be opened.");
      }
    },
    [client],
  );

  const handleAnnotationModeKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const key = event.code || event.key;
      pressedKeys.current = new Set([...pressedKeys.current, key]);

      const hasConflictingKey =
        pressedKeys.current.size !== 1 || hasConflictingModifier(event, ANNOTATION_MODE_HOLD_KEY);
      if (event.key === ANNOTATION_MODE_HOLD_KEY) {
        if (hasConflictingKey) {
          if (holdAnnotationMode.current) {
            holdAnnotationMode.current = false;
            dispatchAnnotation({ type: "mode-changed", enabled: false });
          }
          return;
        }

        if (
          !activeArtifactRevisionId ||
          holdAnnotationMode.current ||
          annotationState.isModeEnabled ||
          annotationState.isManaging ||
          annotationState.isPublishing
        ) {
          return;
        }

        holdAnnotationMode.current = true;
        dispatchAnnotation({ type: "mode-changed", enabled: true });
        return;
      }

      if (holdAnnotationMode.current) {
        holdAnnotationMode.current = false;
        dispatchAnnotation({ type: "mode-changed", enabled: false });
      }
    },
    [activeArtifactRevisionId, annotationState.isManaging, annotationState.isModeEnabled, annotationState.isPublishing],
  );

  const handleAnnotationModeKeyUp = useCallback((event: KeyboardEvent) => {
    const key = event.code || event.key;
    pressedKeys.current = new Set([...pressedKeys.current].filter((pressedKey) => pressedKey !== key));

    if (event.key !== ANNOTATION_MODE_HOLD_KEY || !holdAnnotationMode.current) return;

    holdAnnotationMode.current = false;
    dispatchAnnotation({ type: "mode-changed", enabled: false });
  }, []);

  const handleAnnotationModeBlur = useCallback(() => {
    pressedKeys.current = new Set();

    if (!holdAnnotationMode.current) return;

    holdAnnotationMode.current = false;
    dispatchAnnotation({ type: "mode-changed", enabled: false });
  }, []);

  useEffect(() => addEventListener(document, "keydown", handleAnnotationModeKeyDown), [handleAnnotationModeKeyDown]);
  useEffect(() => addEventListener(document, "keyup", handleAnnotationModeKeyUp), [handleAnnotationModeKeyUp]);
  useEffect(() => addEventListener(globalThis.window, "blur", handleAnnotationModeBlur), [handleAnnotationModeBlur]);

  useEffect(() => {
    let cancelled = false;
    let latestRequest = 0;

    async function synchronizeReview(mode: ReviewLoadMode) {
      const request = latestRequest + 1;
      latestRequest = request;

      try {
        const isCurrent = () => !cancelled && request === latestRequest;
        const bundle = await loadReviewBundle(client, isCurrent);
        if (!bundle || !isCurrent()) return;

        dispatchAnnotation({ type: "annotations-refreshed", annotations: bundle.annotations });
        dispatchReview({ type: "load-succeeded", mode, bundle });
      } catch (error) {
        if (cancelled || request !== latestRequest) return;

        dispatchReview({
          type: "load-failed",
          mode,
          message: error instanceof Error ? error.message : "Review data could not be loaded.",
        });
      }
    }

    const unsubscribe = client.subscribeToReviewUpdates(
      () => void synchronizeReview("refresh"),
      (error) => {
        if (cancelled) return;
        dispatchReview({ type: "load-failed", mode: "refresh", message: error.message });
      },
    );
    void synchronizeReview("initial");

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client]);

  async function confirmAnnotationClose(): Promise<boolean> {
    if (!hasUnsavedAnnotationChanges(annotationState)) return true;

    try {
      return await confirmDialog({
        title: "Discard unsaved comment?",
        description: "Your unsaved comment will be lost.",
        cancelText: "Keep editing",
        actionText: "Discard",
        actionVariant: "destructive",
      });
    } catch {
      return false;
    }
  }

  async function beginAnnotation(anchor: AnnotationAnchor): Promise<void> {
    if (!activeArtifactRevisionId || annotationState.isManaging || annotationState.isPublishing) return;
    if (!(await confirmAnnotationClose())) return;

    dispatchAnnotation({ type: "draft-began", draft: annotationDrafts.begin(anchor) });
  }

  function changeAnnotation(body: string): void {
    dispatchAnnotation({ type: "draft-changed", body });
  }

  async function cancelAnnotation(): Promise<boolean> {
    if (!(await confirmAnnotationClose())) return false;

    dispatchAnnotation({ type: "draft-cancelled" });
    return true;
  }

  function startAnnotationOperation(artifactRevisionId: ArtifactRevisionId, kind: "management" | "publish"): string {
    const operationId = globalThis.crypto.randomUUID();
    dispatchReview({ type: "annotation-operation-started", artifactRevisionId, operationId });
    dispatchAnnotation(
      kind === "publish" ? { type: "publish-started", operationId } : { type: "management-started", operationId },
    );
    return operationId;
  }

  async function publishAnnotation(): Promise<void> {
    if (!activeArtifactRevisionId || !annotationState.draft || annotationState.isPublishing) return;

    const artifactRevisionId = activeArtifactRevisionId;
    const draft = annotationState.draft;
    const operationId = startAnnotationOperation(artifactRevisionId, "publish");
    const result = await annotationDrafts.publish(draft);

    if (result.status === "published") {
      dispatchReview({
        type: "annotations-updated",
        artifactRevisionId,
        operationId,
        annotations: result.document,
      });
      dispatchAnnotation({ type: "publish-succeeded", artifactRevisionId, operationId });
      return;
    }

    dispatchAnnotation({
      type: "publish-failed",
      artifactRevisionId,
      operationId,
      draft: result.draft,
      message: result.message,
    });
  }

  async function openAnnotation(annotationId: string): Promise<void> {
    if (!activeArtifactRevisionId || annotationState.isManaging || state.status !== "ready") return;

    const annotation = state.annotations.annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation || !(await confirmAnnotationClose())) return;

    dispatchAnnotation({
      type: "edit-opened",
      edit: { annotationId, body: annotation.comment.body, source: annotation },
    });
  }

  function changeAnnotationEdit(body: string): void {
    dispatchAnnotation({ type: "edit-changed", body });
  }

  async function closeAnnotationEdit(): Promise<boolean> {
    if (!(await confirmAnnotationClose())) return false;

    dispatchAnnotation({ type: "edit-closed" });
    return true;
  }

  async function resolveAnnotationEditConflict(resolution: AnnotationEditConflictResolution): Promise<void> {
    const edit = annotationState.edit;
    if (!edit?.conflict || annotationState.isManaging) return;

    if (resolution === "discard-local") {
      dispatchAnnotation({ type: "edit-conflict-resolved" });
      return;
    }

    if (resolution === "restore-local" && activeArtifactRevisionId) {
      const artifactRevisionId = activeArtifactRevisionId;
      const operationId = startAnnotationOperation(artifactRevisionId, "management");
      const result = await annotationDrafts.publish({ anchor: edit.source.anchor, body: edit.body });

      if (result.status === "published") {
        dispatchReview({
          type: "annotations-updated",
          artifactRevisionId,
          operationId,
          annotations: result.document,
        });
        dispatchAnnotation({ type: "edit-management-succeeded", artifactRevisionId, operationId });
        return;
      }

      dispatchAnnotation({
        type: "management-failed",
        artifactRevisionId,
        operationId,
        message: result.message,
      });
      return;
    }

    if (edit.conflict.kind !== "changed") return;

    const external = edit.conflict.external;
    dispatchAnnotation({
      type: "edit-conflict-resolved",
      edit:
        resolution === "use-external"
          ? {
              annotationId: external.id,
              body: external.comment.body,
              source: external,
            }
          : { ...edit, conflict: undefined, source: external },
    });
  }

  async function saveAnnotationEdit(): Promise<boolean> {
    const edit = annotationState.edit;
    if (!activeArtifactRevisionId || !edit || annotationState.isManaging) return false;

    const artifactRevisionId = activeArtifactRevisionId;
    const operationId = startAnnotationOperation(artifactRevisionId, "management");
    const result = await annotationManager.update(edit.annotationId, edit.body);

    if (result.status === "updated") {
      dispatchReview({
        type: "annotations-updated",
        artifactRevisionId,
        operationId,
        annotations: result.document,
      });
      dispatchAnnotation({ type: "edit-management-succeeded", artifactRevisionId, operationId });
      return true;
    }

    dispatchAnnotation({
      type: "management-failed",
      artifactRevisionId,
      operationId,
      message: result.message,
    });
    return false;
  }

  async function removeAnnotationEdit(): Promise<void> {
    const edit = annotationState.edit;
    if (!activeArtifactRevisionId || !edit || annotationState.isManaging) return;

    const artifactRevisionId = activeArtifactRevisionId;
    const operationId = startAnnotationOperation(artifactRevisionId, "management");
    const result = await annotationManager.remove(edit.annotationId);

    if (result.status === "deleted") {
      dispatchReview({
        type: "annotations-updated",
        artifactRevisionId,
        operationId,
        annotations: result.document,
      });
      dispatchAnnotation({ type: "edit-management-succeeded", artifactRevisionId, operationId });
      return;
    }

    dispatchAnnotation({
      type: "management-failed",
      artifactRevisionId,
      operationId,
      message: result.message,
    });
  }

  async function moveAnnotation(annotationId: string, point: AnnotationAnchor["point"]): Promise<void> {
    if (!activeArtifactRevisionId || annotationState.isManaging || state.status !== "ready") return;

    const source = state.annotations.annotations.find((annotation) => annotation.id === annotationId);
    if (!source) return;

    const artifactRevisionId = activeArtifactRevisionId;
    const operationId = startAnnotationOperation(artifactRevisionId, "management");
    const result = await annotationManager.move(annotationId, point);

    if (result.status === "moved") {
      dispatchReview({
        type: "annotations-updated",
        artifactRevisionId,
        operationId,
        annotations: result.document,
      });
      dispatchAnnotation({
        type: "move-succeeded",
        artifactRevisionId,
        operationId,
        annotations: result.document,
      });
      return;
    }

    dispatchAnnotation({
      type: "management-failed",
      artifactRevisionId,
      operationId,
      message: result.message,
      fallbackEdit: { annotationId, body: source.comment.body, source },
    });
  }

  if (state.status === "loading") {
    return <main className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading review…</main>;
  }

  if (state.status === "error") {
    return (
      <main className="grid min-h-screen place-items-center p-8">
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      </main>
    );
  }

  const { scope } = state.review;
  const reviewErrorMessage = state.updateError ?? getReviewErrorMessage(state.review);
  const scopeName =
    scope.path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) ?? scope.path;

  if (!state.review.artifact) {
    return (
      <Tabs className="contents" defaultValue="process">
        <WorkspaceShell
          actions={
            <Toggle disabled size="sm" variant="outline">
              <MessageSquarePlus data-icon="inline-start" />
              Comment
            </Toggle>
          }
          navigation={
            <TabsList aria-label="Review views">
              <TabsTrigger value="process">Product Behavior</TabsTrigger>
              <TabsTrigger disabled value="design">
                Code Design
              </TabsTrigger>
            </TabsList>
          }
          scopeName={scopeName}
        >
          <TabsContent className="h-full min-h-0 overflow-hidden rounded-xl border bg-background" value="process">
            {reviewErrorMessage ? (
              <div className="grid h-full place-items-center p-8">
                <p className="text-sm text-destructive" role="alert">
                  {reviewErrorMessage}
                </p>
              </div>
            ) : (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderSearch aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle aria-level={2} role="heading">
                    No review artifacts yet
                  </EmptyTitle>
                  <EmptyDescription>
                    Add an Architecture Companion artifact to this scope, then refresh the review.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </TabsContent>
        </WorkspaceShell>
      </Tabs>
    );
  }

  const { artifact } = state.review;
  const activeProcess = artifact.behaviors.find(({ id }) => id === activeProcessId) ?? artifact.behaviors.at(0);
  const activeDesign = artifact.designs.find(({ id }) => id === activeDesignId) ?? artifact.designs.at(0);
  const activeReviewView: ReviewView | null =
    requestedReviewView === "process" && activeProcess
      ? "process"
      : requestedReviewView === "design" && activeDesign
        ? "design"
        : activeProcess
          ? "process"
          : activeDesign
            ? "design"
            : null;
  const activeDiagramCollection =
    activeReviewView === "process" && activeProcess
      ? {
          activeDiagram: activeProcess,
          ariaLabel: `${activeProcess.title} product behavior diagram`,
          annotationSurface: { canvasId: `behavior:${activeProcess.id}` },
          diagrams: artifact.behaviors,
          heading: "Product Behaviors",
          onSelect: setActiveProcessId,
        }
      : activeReviewView === "design" && activeDesign
        ? {
            activeDiagram: activeDesign,
            ariaLabel: `${activeDesign.title} code design diagram`,
            annotationSurface: { canvasId: `design:${activeDesign.id}` },
            diagrams: artifact.designs,
            heading: "Code Designs",
            onSelect: setActiveDesignId,
          }
        : undefined;
  const annotationController: AnnotationReviewController = {
    document: state.annotations,
    draft: annotationState.draft,
    edit: annotationState.edit,
    editError: annotationState.editError,
    error: annotationState.draftError,
    isCommentMode:
      Boolean(activeArtifactRevisionId) &&
      annotationState.isModeEnabled &&
      !annotationState.isManaging &&
      !annotationState.isPublishing,
    isManaging: annotationState.isManaging,
    isPublishing: annotationState.isPublishing,
    begin: beginAnnotation,
    change: changeAnnotation,
    changeEdit: changeAnnotationEdit,
    cancel: cancelAnnotation,
    closeEdit: closeAnnotationEdit,
    move: moveAnnotation,
    open: openAnnotation,
    publish: publishAnnotation,
    removeEdit: removeAnnotationEdit,
    resolveEditConflict: resolveAnnotationEditConflict,
    saveEdit: saveAnnotationEdit,
  };
  return (
    <Tabs
      className="contents"
      value={activeReviewView}
      onValueChange={(value) => {
        if (value === "process" || value === "design") setRequestedReviewView(value);
      }}
    >
      <WorkspaceShell
        actions={
          <Toggle
            disabled={!activeArtifactRevisionId}
            onPressedChange={(enabled) => dispatchAnnotation({ type: "mode-changed", enabled })}
            pressed={annotationState.isModeEnabled}
            size="sm"
            variant="outline"
          >
            <MessageSquarePlus data-icon="inline-start" />
            Comment
          </Toggle>
        }
        navigation={
          <TabsList aria-label="Review views">
            <TabsTrigger disabled={artifact.behaviors.length === 0} value="process">
              Product Behavior
            </TabsTrigger>
            <TabsTrigger disabled={artifact.designs.length === 0} value="design">
              Code Design
            </TabsTrigger>
          </TabsList>
        }
        scopeName={scopeName}
      >
        {activeDiagramCollection && activeReviewView ? (
          <TabsContent className="h-full min-h-0" value={activeReviewView}>
            <h2 className="sr-only">{activeDiagramCollection.heading}</h2>
            <div className="grid h-full min-h-0 min-w-0 grid-cols-[16rem_minmax(0,1fr)] gap-3">
              <DiagramList
                activeDiagramId={activeDiagramCollection.activeDiagram.id}
                diagrams={activeDiagramCollection.diagrams}
                heading={activeDiagramCollection.heading}
                onSelect={activeDiagramCollection.onSelect}
              />
              <div className="min-h-0 overflow-hidden rounded-xl bg-surface ring-1 ring-foreground/10">
                <DiagramRenderer
                  ariaLabel={activeDiagramCollection.ariaLabel}
                  annotations={{ ...annotationController, surface: activeDiagramCollection.annotationSurface }}
                  diagram={activeDiagramCollection.activeDiagram}
                  onOpenSource={openSource}
                />
              </div>
            </div>
          </TabsContent>
        ) : null}

        {reviewErrorMessage || sourceError ? (
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col gap-2">
            {reviewErrorMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {reviewErrorMessage}
              </p>
            ) : null}
            {sourceError ? (
              <p className="text-sm text-destructive" role="alert">
                {sourceError}
              </p>
            ) : null}
          </div>
        ) : null}
      </WorkspaceShell>
    </Tabs>
  );
}
