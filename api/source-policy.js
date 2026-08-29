export const POLICIES = {
  or: {
    label: "Oregon — OHA Psilocybin Services",
    sourceClass: "official",
    allowedHosts: ["oregon.gov"],
    requiredAny: ["psilocybin", "oregon psilocybin services", "ors 475a", "oha"],
    baseline: {
      title: "Oregon Psilocybin Services — official program portal",
      url: "https://www.oregon.gov/oha/ph/preventionwellness/pages/oregon-psilocybin-services.aspx",
      authority: "Oregon Health Authority"
    }
  },
  co: {
    label: "Colorado — Natural Medicine Program",
    sourceClass: "official",
    allowedHosts: ["colorado.gov"],
    requiredAny: ["natural medicine", "psilocybin", "healing center", "facilitator"],
    baseline: {
      title: "Colorado Natural Medicine Program — official portal",
      url: "https://dpo.colorado.gov/NaturalMedicine",
      authority: "Colorado Division of Professions and Occupations"
    }
  },
  nm: {
    label: "New Mexico — Medical Psilocybin Program",
    sourceClass: "official",
    allowedHosts: ["nmhealth.org", "nm.gov"],
    requiredAny: ["medical psilocybin", "psilocybin program", "psilocybin advisory"],
    baseline: {
      title: "New Mexico Medical Psilocybin Program — official portal",
      url: "https://www.nmhealth.org/about/mcpp/mpp/",
      authority: "New Mexico Department of Health"
    }
  },
  intel: {
    label: "Field Intelligence — Legal & Policy",
    sourceClass: "secondary",
    allowedHosts: ["psychedelicalpha.com", "vicentellp.com", "harris-sliwoski.com"],
    requiredAny: ["psilocybin", "psychedelic", "natural medicine"],
    baseline: {
      title: "Psychedelic Alpha — policy and regulation tracker",
      url: "https://psychedelicalpha.com/",
      authority: "Psychedelic Alpha"
    }
  },
  psfc: {
    label: "PSFC — Psychedelic Science Funders Collaborative",
    sourceClass: "organization",
    allowedHosts: ["psfc.co"],
    requiredAny: ["psychedelic", "psfc", "funders collaborative"],
    baseline: {
      title: "Psychedelic Science Funders Collaborative — official site",
      url: "https://psfc.co/",
      authority: "Psychedelic Science Funders Collaborative"
    }
  },
  haf: {
    label: "HAF — Healing Advocacy Fund",
    sourceClass: "organization",
    allowedHosts: ["healingadvocacyfund.org"],
    requiredAny: ["psilocybin", "psychedelic", "healing advocacy fund"],
    baseline: {
      title: "Healing Advocacy Fund — official site",
      url: "https://healingadvocacyfund.org/",
      authority: "Healing Advocacy Fund"
    }
  }
};

const BLOCKED_HOSTS = ["linkedin.com", "wikipedia.org", "indeed.com", "glassdoor.com", "facebook.com", "instagram.com", "x.com"];

export function hostMatches(host, allowed) {
  return allowed.some(value => host === value || host.endsWith("." + value));
}

// `stored: true` is used when re-reading records that already passed this policy
// at collection time. The topic test must not run again there: the discovery
// provider's full `text` is not persisted, only a truncated `snippet`, so
// re-testing rejects records that genuinely qualified — silently emptying
// categories whose stored state still reads "completed_with_findings", and
// counting the losses as "rejected noise". Host and scheme are stable, so those
// are still enforced on every read.
export function validateCandidate(item, key, { stored = false } = {}) {
  const policy = POLICIES[key];
  const reasons = [];
  let url;
  try {
    url = new URL(item.url);
    if (url.protocol !== "https:") reasons.push("non_https_url");
  } catch {
    return { accepted: false, reasons: ["invalid_url"] };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostMatches(host, BLOCKED_HOSTS)) reasons.push("blocked_source");
  if (!hostMatches(host, policy.allowedHosts)) reasons.push("outside_source_policy");
  if (!stored) {
    const haystack = [item.title, item.text, item.snippet].filter(Boolean).join(" ").toLowerCase();
    if (!policy.requiredAny.some(term => haystack.includes(term))) reasons.push("topic_mismatch");
  }
  return { accepted: reasons.length === 0, reasons, host };
}

export function monitoredSource(key) {
  const policy = POLICIES[key];
  return {
    ...policy.baseline,
    sourceClass: policy.sourceClass,
    recordType: "monitored_source",
    validation: "verified_source_endpoint",
    verifiedAt: "2026-08-17",
    published: null,
    snippet: "Verified source endpoint used by this monitor. This is a source registry record, not a claim that a new update was published."
  };
}

export const KEYS = Object.keys(POLICIES);
