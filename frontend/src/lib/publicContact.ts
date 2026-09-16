import { useEffect, useState } from "react";
import { api } from "./api";

export type PublicContact = {
  utilityName?: string | null;
  emailAddress?: string | null;
  phoneNumber?: string | null;
  postalAddress?: string | null;
  postalCode?: string | null;
  physicalAddress?: string | null;
};

export function usePublicContact() {
  const [contact, setContact] = useState<PublicContact>({});

  useEffect(() => {
    let active = true;
    api.getPublicContact()
      .then((value: PublicContact) => {
        if (active) setContact(value ?? {});
      })
      .catch(() => {
        if (active) setContact({});
      });
    return () => {
      active = false;
    };
  }, []);

  return contact;
}
