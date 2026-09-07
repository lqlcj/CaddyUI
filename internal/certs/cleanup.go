package certs

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CleanupResult counts certificate bundles, including their key and metadata.
type CleanupResult struct {
	Removed int
	Kept    int
}

// Cleanup removes only standard bundles whose entire identity belongs to the
// deleted site. remaining includes disabled sites, which may be enabled later.
func (l *Locator) Cleanup(domains, remaining []string) (CleanupResult, error) {
	var result CleanupResult
	if l == nil || l.CertRoot() == "" {
		return result, errors.New("certificate storage is not configured")
	}
	root, err := os.OpenRoot(l.CertRoot())
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, err
	}
	defer root.Close()
	dir, err := root.Open(".")
	if err != nil {
		return result, err
	}
	issuers, err := dir.ReadDir(-1)
	dir.Close()
	if err != nil {
		return result, err
	}
	owned := make(map[string]bool)
	for _, domain := range domains {
		owned[strings.ToLower(domain)] = true
	}
	var failures []error
	for _, issuer := range issuers {
		if !issuer.IsDir() || issuer.Type()&os.ModeSymlink != 0 {
			continue
		}
		for domain := range owned {
			subject := storageSubject(domain)
			if subject == "." || subject == ".." || strings.ContainsAny(subject, `/\\:`) || !filepath.IsLocal(subject) {
				result.Kept++
				continue
			}
			base := filepath.Join(issuer.Name(), subject)
			st, err := root.Lstat(base)
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			if err != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 {
				result.Kept++
				continue
			}
			paths := []string{filepath.Join(base, subject+".key"), filepath.Join(base, subject+".json"), filepath.Join(base, subject+".crt")}
			safe := true
			for _, path := range paths {
				st, err := root.Lstat(path)
				if errors.Is(err, os.ErrNotExist) {
					continue
				}
				if err != nil || !st.Mode().IsRegular() {
					safe = false
				}
			}
			if !safe {
				result.Kept++
				continue
			}
			raw, err := root.ReadFile(paths[2])
			if err != nil || len(raw) > 2<<20 {
				result.Kept++
				continue
			}
			block, _ := pem.Decode(raw)
			if block == nil || block.Type != "CERTIFICATE" {
				result.Kept++
				continue
			}
			leaf, err := x509.ParseCertificate(block.Bytes)
			if err != nil || !exclusiveCertificate(leaf, domain, owned, remaining) {
				result.Kept++
				continue
			}
			complete := true
			for _, path := range paths {
				if err := root.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
					failures = append(failures, fmt.Errorf("remove %s: %w", path, err))
					complete = false
					break
				}
			}
			if complete {
				result.Removed++
				// Remove only an empty directory; unrelated files are never removed.
				_ = root.Remove(base)
			} else {
				result.Kept++
			}
		}
	}
	return result, errors.Join(failures...)
}

func exclusiveCertificate(leaf *x509.Certificate, domain string, owned map[string]bool, remaining []string) bool {
	names := append([]string(nil), leaf.DNSNames...)
	for _, ip := range leaf.IPAddresses {
		names = append(names, ip.String())
	}
	if len(names) == 0 || len(leaf.EmailAddresses) > 0 || len(leaf.URIs) > 0 {
		return false
	}
	found := false
	for _, name := range names {
		name = strings.ToLower(name)
		if !owned[name] {
			return false
		}
		found = found || name == domain
		for _, other := range remaining {
			other = strings.ToLower(other)
			if name == other || wildcardCovers(name, other) || wildcardCovers(other, name) {
				return false
			}
		}
	}
	return found
}

func wildcardCovers(pattern, domain string) bool {
	if !strings.HasPrefix(pattern, "*.") {
		return false
	}
	suffix := pattern[1:]
	label, ok := strings.CutSuffix(domain, suffix)
	return ok && label != "" && !strings.Contains(label, ".")
}
