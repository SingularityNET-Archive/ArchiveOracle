import { useState } from "react";
import type { NextPage } from "next";

const Contact: NextPage = () => {
  const [assets, setAssets] = useState<null | any>(null);
  const [loading, setLoading] = useState<boolean>(false);

  async function getAssets() {
    
  }

  return (
    <div>
      <h1>Contact</h1>
    </div>
  );
};

export default Contact;