export const accountLinkSerializer = (accountLink) => {
  return {
    id: accountLink.id,
    status: accountLink.status,
    linked_account_id: accountLink.linked_account_id,
    created_by_id: accountLink.created_by_id,
    linked_account: accountLink.linked_account ? {
      id: accountLink.linked_account.id,
      name: accountLink.linked_account.name, // Family name like "Fogg"
      display_name: accountLink.linked_account.metadata?.display_name || "Family Member", // Cached generated display name
      avatar: accountLink.linked_account.metadata?.avatar,
    } : null,
    from_account: accountLink.account ? {
      id: accountLink.account.id,
      name: accountLink.account.name, // Family name like "Fogg"
      display_name: accountLink.account.metadata?.display_name || "Family Member", // Cached generated display name
      avatar: accountLink.account.metadata?.avatar,
    } : null,
    created_at: accountLink.created_at,
    metadata: accountLink.metadata,
  };
};

export const accountLinkListSerializer = (accountLinks) => {
  return accountLinks.map(link => accountLinkSerializer(link));
};