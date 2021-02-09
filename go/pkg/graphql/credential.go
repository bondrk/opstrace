// Copyright 2021 Opstrace, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package graphql

import (
	"net/url"
)

type CredentialAccess struct {
	tenant String
	access *graphqlAccess
}

func NewCredentialAccess(tenant string, graphqlURL *url.URL, graphqlSecret string) CredentialAccess {
	return CredentialAccess{
		String(tenant),
		newGraphqlAccess(graphqlURL, graphqlSecret),
	}
}

// FixedGetCredentialsResponse fixes missing underscores in GetCredentialResponse fields.
// Remove this if/when the generator is fixed.
type FixedGetCredentialsResponse struct {
	Credential []struct {
		Tenant    string `json:"Tenant"`
		Name      string `json:"Name"`
		Type      string `json:"Type"`
		CreatedAt string `json:"Created_At"` // fix missing underscore
		UpdatedAt string `json:"Updated_At"` // fix missing underscore
	} `json:"Credential"`
}

func (c *CredentialAccess) List() (*FixedGetCredentialsResponse, error) {
	req, err := NewGetCredentialsRequest(c.access.URL, &GetCredentialsVariables{Tenant: c.tenant})
	if err != nil {
		return nil, err
	}

	var result FixedGetCredentialsResponse
	if err := c.access.Execute(req.Request, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// FixedGetCredentialResponse fixes missing underscores in GetCredentialResponse fields.
// Remove this if/when the generator is fixed.
type FixedGetCredentialResponse struct {
	CredentialByPk struct {
		Tenant    string `json:"Tenant"`
		Name      string `json:"Name"`
		Type      string `json:"Type"`
		CreatedAt string `json:"Created_At"` // fix missing underscore
		UpdatedAt string `json:"Updated_At"` // fix missing underscore
	} `json:"Credential_By_Pk"` // fix missing underscore
}

func (c *CredentialAccess) Get(name string) (*FixedGetCredentialResponse, error) {
	req, err := NewGetCredentialRequest(c.access.URL, &GetCredentialVariables{Tenant: c.tenant, Name: String(name)})
	if err != nil {
		return nil, err
	}

	var result FixedGetCredentialResponse
	if err := c.access.Execute(req.Request, &result); err != nil {
		return nil, err
	}
	if result.CredentialByPk.Name == "" {
		// Not found
		return nil, nil
	}
	return &result, nil
}

// FixedDeleteCredentialResponse missing underscores in DeleteCredentialResponse fields.
// Remove this if/when the generator is fixed.
type FixedDeleteCredentialResponse struct {
	DeleteCredentialByPk struct {
		Tenant string `json:"Tenant"`
		Name   string `json:"Name"`
	} `json:"Delete_Credential_By_Pk"` // fix missing underscore
}

func (c *CredentialAccess) Delete(name string) (*FixedDeleteCredentialResponse, error) {
	req, err := NewDeleteCredentialRequest(c.access.URL, &DeleteCredentialVariables{Tenant: c.tenant, Name: String(name)})
	if err != nil {
		return nil, err
	}

	// Use custom type to deserialize since the generated one is broken
	var result FixedDeleteCredentialResponse
	if err := c.access.Execute(req.Request, &result); err != nil {
		return nil, err
	}
	if result.DeleteCredentialByPk.Name == "" {
		// Not found
		return nil, nil
	}
	return &result, nil
}

// Insert inserts one or more credentials, returns an error if any already exists.
func (c *CredentialAccess) Insert(inserts []CredentialInsertInput) error {
	// Ensure the inserts each have the correct tenant name
	insertsWithTenant := make([]CredentialInsertInput, 0)
	for _, insert := range inserts {
		insert.Tenant = &c.tenant
		insertsWithTenant = append(insertsWithTenant, insert)
	}

	req, err := NewCreateCredentialsRequest(c.access.URL, &CreateCredentialsVariables{Credentials: &insertsWithTenant})
	if err != nil {
		return err
	}

	var result CreateCredentialsResponse
	return c.access.Execute(req.Request, &result)
}

// Update updates an existing credential, returns an error if a credential of the same tenant/name doesn't exist.
func (c *CredentialAccess) Update(update UpdateCredentialVariables) error {
	// Ensure the update has the correct tenant name
	update.Tenant = c.tenant

	req, err := NewUpdateCredentialRequest(c.access.URL, &update)
	if err != nil {
		return err
	}

	var result UpdateCredentialResponse
	return c.access.Execute(req.Request, &result)
}