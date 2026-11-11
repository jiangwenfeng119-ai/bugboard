"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DeleteProjectButton } from "../DeleteProjectButton";
import type { ProjectDocument } from "@/lib/project-documents";
import { projectLogoSrc } from "@/lib/project-logo-shared";
import { profileStamp, type ProjectProfile } from "@/lib/project-profile";
import { ProjectProfileDialog } from "./ProjectProfileDialog";

export function ProjectHeader({
  projectId,
  name,
  code,
  description,
  hasLogo,
  updatedAt,
  profile,
  documents,
  isAdmin,
  canDelete,
}: {
  projectId: number;
  name: string;
  code: string;
  description: string;
  hasLogo: boolean;
  updatedAt: string;
  profile: ProjectProfile;
  documents: ProjectDocument[];
  isAdmin: boolean;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shownName, setShownName] = useState(name);
  const [shownCode, setShownCode] = useState(code);
  const [shownDescription, setShownDescription] = useState(description);
  const [shownHasLogo, setShownHasLogo] = useState(hasLogo);
  const [shownUpdatedAt, setShownUpdatedAt] = useState(updatedAt);
  const [shownProfile, setShownProfile] = useState(profile);
  const [shownDocuments, setShownDocuments] = useState(documents);
  const stamp = useMemo(() => profileStamp(profile), [profile]);
  const docStamp = documents.map((doc) => `${doc.id}:${doc.filename}:${doc.size}`).join(",");
  const profileRef = useRef(profile);
  const documentsRef = useRef(documents);
  profileRef.current = profile;
  documentsRef.current = documents;

  useEffect(() => {
    setOpen(false);
  }, [projectId]);

  useEffect(() => {
    setShownName(name);
    setShownCode(code);
    setShownDescription(description);
    setShownHasLogo(hasLogo);
    setShownUpdatedAt(updatedAt);
    setShownProfile(profileRef.current);
    setShownDocuments(documentsRef.current);
  }, [name, code, description, hasLogo, updatedAt, stamp, docStamp]);

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <Link href="/projects" className="bb-crumb">
        ← 全部项目
      </Link>
      <div className="bb-project-heading">
        {shownHasLogo ? (
          // 登录后的项目图，浏览器直接带上 cookie，不用图片优化器。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="bb-project-mark"
            src={projectLogoSrc(projectId, shownUpdatedAt)}
            alt=""
          />
        ) : null}
        <h1>{shownName}</h1>
        <code className="bb-slug" title="报障 ID 前缀">
          {shownCode}
        </code>
        <button type="button" className="bb-btn bb-btn-ghost" onClick={() => setOpen(true)}>
          详情
        </button>
        {canDelete ? (
          <DeleteProjectButton
            projectId={projectId}
            projectName={shownName}
            redirectTo="/projects"
            compact
          />
        ) : null}
      </div>
      {shownDescription ? (
        <p className="bb-muted bb-measure" style={{ margin: 0 }}>
          {shownDescription}
        </p>
      ) : null}
      <ProjectProfileDialog
        open={open}
        projectId={projectId}
        isAdmin={isAdmin}
        draft={{
          name: shownName,
          code: shownCode,
          description: shownDescription,
          profile: shownProfile,
        }}
        hasLogo={shownHasLogo}
        updatedAt={shownUpdatedAt}
        documents={shownDocuments}
        onClose={() => setOpen(false)}
        onSaved={(project) => {
          setShownName(project.name);
          setShownCode(project.code);
          setShownDescription(project.description);
          setShownHasLogo(project.hasLogo);
          setShownUpdatedAt(project.updatedAt);
          setShownProfile(project.profile);
          setShownDocuments(project.documents);
          router.refresh();
        }}
      />
    </div>
  );
}
